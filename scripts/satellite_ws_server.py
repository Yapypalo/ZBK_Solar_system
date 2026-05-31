from __future__ import annotations

import argparse
import asyncio
import base64
import contextlib
import hashlib
import json
import math
import random
import signal
import struct
from dataclasses import dataclass
from datetime import datetime, timezone
from turtle import speed
from typing import Any, Literal

import numpy as np

import astropy.units as u
from astropy.coordinates import EarthLocation, get_sun
from astropy.time import Time
import pyIGRF14


EARTH_MU_KM3_S2 = 398_600.4418
EARTH_RADIUS_KM = 6_378.137
EARTH_J2 = 1.08262668e-3
EARTH_J3 = -2.5324105e-6
EARTH_J4 = -1.6198976e-6
ASTRONOMICAL_UNIT_KM = 149_597_870.7
SOLAR_CONSTANT_W_M2 = 1_361.0
SOLAR_PRESSURE_N_M2 = 4.56e-6
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
REAL_STEP_SECONDS = 0.1
SIM_STEP_SECONDS = 0.1
OMEGA_BODY_RAD_S = (0.0, 0.0, 0.5)
SPACECRAFT_MASS_KG = 4.0
SPACECRAFT_DRAG_AREA_M2 = 0.01
SPACECRAFT_DRAG_COEFF = 2.2
SPACECRAFT_SRP_AREA_M2 = 0.06
SPACECRAFT_SRP_COEFF = 1.35
SPACECRAFT_MAGNETOMETER_NOISE_NT = 12.0
SPACECRAFT_PANEL_NOISE_W_M2 = 2.5
SPACECRAFT_PANEL_RELATIVE_NOISE = 0.012
SPACECRAFT_REFERENCE_DENSITY_KG_M3 = 2.5e-12
SPACECRAFT_DENSITY_SCALE_HEIGHT_KM = 70.0
WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


Quaternion = tuple[float, float, float, float]
Vector3 = tuple[float, float, float]
EstimatorMethod = Literal["boresight", "panels", "ekf"]


@dataclass(frozen=True)
class OrbitConfig:
    altitude_km: float = 500.0
    inclination_deg: float = 45.0
    raan_deg: float = 0.0
    true_anomaly_deg_at_epoch: float = 0.0
    epoch_time_s: float = 0.0

    @property
    def radius_km(self) -> float:
        return EARTH_RADIUS_KM + self.altitude_km

    @property
    def semi_major_axis_km(self) -> float:
        return self.radius_km

    @property
    def eccentricity(self) -> float:
        return 0.0

    @property
    def mean_motion_rad_s(self) -> float:
        return math.sqrt(EARTH_MU_KM3_S2 / self.radius_km**3)

    @property
    def orbital_speed_km_s(self) -> float:
        return math.sqrt(EARTH_MU_KM3_S2 / self.radius_km)

    @property
    def period_seconds(self) -> float:
        return (2.0 * math.pi) / self.mean_motion_rad_s


def quaternion_identity() -> Quaternion:
    return (0.0, 0.0, 0.0, 1.0)


def quaternion_normalize(q: Quaternion) -> Quaternion:
    x, y, z, w = q
    length = math.sqrt(x * x + y * y + z * z + w * w)
    if length <= 0.0:
        return quaternion_identity()
    inv = 1.0 / length
    return (x * inv, y * inv, z * inv, w * inv)


def quaternion_conjugate(q: Quaternion) -> Quaternion:
    x, y, z, w = q
    return (-x, -y, -z, w)


def quaternion_multiply(a: Quaternion, b: Quaternion) -> Quaternion:
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def quaternion_scale(q: Quaternion, factor: float) -> Quaternion:
    return (q[0] * factor, q[1] * factor, q[2] * factor, q[3] * factor)


def quaternion_add(a: Quaternion, b: Quaternion) -> Quaternion:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3])


def quaternion_derivative(q: Quaternion, omega_body: Vector3) -> Quaternion:
    omega_q: Quaternion = (omega_body[0], omega_body[1], omega_body[2], 0.0)
    return quaternion_scale(quaternion_multiply(q, omega_q), 0.5)


def quaternion_rk4_step(q: Quaternion, omega_body: Vector3, dt: float) -> Quaternion:
    k1 = quaternion_derivative(q, omega_body)
    k2 = quaternion_derivative(quaternion_add(q, quaternion_scale(k1, dt * 0.5)), omega_body)
    k3 = quaternion_derivative(quaternion_add(q, quaternion_scale(k2, dt * 0.5)), omega_body)
    k4 = quaternion_derivative(quaternion_add(q, quaternion_scale(k3, dt)), omega_body)

    delta = quaternion_scale(
        quaternion_add(
            quaternion_add(k1, quaternion_scale(k2, 2.0)),
            quaternion_add(quaternion_scale(k3, 2.0), k4),
        ),
        dt / 6.0,
    )
    return quaternion_normalize(quaternion_add(q, delta))


def quaternion_rotate_vector(q: Quaternion, v: Vector3) -> Vector3:
    qv: Quaternion = (v[0], v[1], v[2], 0.0)
    rotated = quaternion_multiply(quaternion_multiply(q, qv), quaternion_conjugate(q))
    return (rotated[0], rotated[1], rotated[2])


def vector_length(v: Vector3) -> float:
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


def vector_normalize(v: Vector3) -> Vector3:
    length = vector_length(v)
    if length <= 0.0:
        return (0.0, 0.0, 0.0)
    inv = 1.0 / length
    return (v[0] * inv, v[1] * inv, v[2] * inv)


def vector_sub(a: Vector3, b: Vector3) -> Vector3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vector_dot(a: Vector3, b: Vector3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def vector_cross(a: Vector3, b: Vector3) -> Vector3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def vector_scale(v: Vector3, factor: float) -> Vector3:
    return (v[0] * factor, v[1] * factor, v[2] * factor)


def vector_add(a: Vector3, b: Vector3) -> Vector3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def vector_subtract(a: Vector3, b: Vector3) -> Vector3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def matrix_skew(v: Vector3) -> np.ndarray:
    x, y, z = v
    return np.array(
        [
            [0.0, -z, y],
            [z, 0.0, -x],
            [-y, x, 0.0],
        ],
        dtype=float,
    )


def rotation_matrix_to_quaternion(matrix: np.ndarray) -> Quaternion:
    m00 = float(matrix[0, 0])
    m01 = float(matrix[0, 1])
    m02 = float(matrix[0, 2])
    m10 = float(matrix[1, 0])
    m11 = float(matrix[1, 1])
    m12 = float(matrix[1, 2])
    m20 = float(matrix[2, 0])
    m21 = float(matrix[2, 1])
    m22 = float(matrix[2, 2])
    trace = m00 + m11 + m22
    if trace > 0.0:
        s = math.sqrt(trace + 1.0) * 2.0
        return quaternion_normalize(
            (
                (m21 - m12) / s,
                (m02 - m20) / s,
                (m10 - m01) / s,
                0.25 * s,
            )
        )
    if m00 > m11 and m00 > m22:
        s = math.sqrt(max(1e-12, 1.0 + m00 - m11 - m22)) * 2.0
        return quaternion_normalize(
            (
                0.25 * s,
                (m01 + m10) / s,
                (m02 + m20) / s,
                (m21 - m12) / s,
            )
        )
    if m11 > m22:
        s = math.sqrt(max(1e-12, 1.0 + m11 - m00 - m22)) * 2.0
        return quaternion_normalize(
            (
                (m01 + m10) / s,
                0.25 * s,
                (m12 + m21) / s,
                (m02 - m20) / s,
            )
        )
    s = math.sqrt(max(1e-12, 1.0 + m22 - m00 - m11)) * 2.0
    return quaternion_normalize(
        (
            (m02 + m20) / s,
            (m12 + m21) / s,
            0.25 * s,
            (m10 - m01) / s,
        )
    )


def quaternion_from_axis_angle(axis: Vector3, angle_rad: float) -> Quaternion:
    axis_length = vector_length(axis)
    if axis_length <= 0.0 or abs(angle_rad) <= 1e-12:
        return quaternion_identity()
    unit_axis = vector_scale(axis, 1.0 / axis_length)
    half_angle = 0.5 * angle_rad
    sin_half = math.sin(half_angle)
    return (
        unit_axis[0] * sin_half,
        unit_axis[1] * sin_half,
        unit_axis[2] * sin_half,
        math.cos(half_angle),
    )


def quaternion_to_numpy(q: Quaternion) -> np.ndarray:
    return np.array([q[0], q[1], q[2], q[3]], dtype=float)


def quaternion_from_numpy(values: np.ndarray) -> Quaternion:
    return quaternion_normalize((float(values[0]), float(values[1]), float(values[2]), float(values[3])))


def quaternion_scalar_multiply(q: Quaternion, factor: float) -> Quaternion:
    return (q[0] * factor, q[1] * factor, q[2] * factor, q[3] * factor)


def quaternion_error_angle_deg(reference: Quaternion, estimate: Quaternion) -> float:
    q_ref = quaternion_normalize(reference)
    q_est = quaternion_normalize(estimate)
    dot = abs(
        q_ref[0] * q_est[0] + q_ref[1] * q_est[1] + q_ref[2] * q_est[2] + q_ref[3] * q_est[3]
    )
    dot = max(0.0, min(1.0, dot))
    return math.degrees(2.0 * math.acos(dot))


def quaternion_dot(a: Quaternion, b: Quaternion) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]


def quaternion_slerp(a: Quaternion, b: Quaternion, t: float) -> Quaternion:
    t = max(0.0, min(1.0, t))
    dot = quaternion_dot(a, b)
    if dot < 0.0:
        b = quaternion_scalar_multiply(b, -1.0)
        dot = -dot
    if dot > 0.9995:
        blended = quaternion_add(quaternion_scalar_multiply(a, 1.0 - t), quaternion_scalar_multiply(b, t))
        return quaternion_normalize(blended)
    theta_0 = math.acos(max(-1.0, min(1.0, dot)))
    theta = theta_0 * t
    sin_theta_0 = math.sin(theta_0)
    if abs(sin_theta_0) <= 1e-12:
        return quaternion_normalize(a)
    s0 = math.sin(theta_0 - theta) / sin_theta_0
    s1 = math.sin(theta) / sin_theta_0
    return quaternion_normalize(
        quaternion_add(quaternion_scalar_multiply(a, s0), quaternion_scalar_multiply(b, s1))
    )


def quaternion_multiply_left(delta: Quaternion, q: Quaternion) -> Quaternion:
    return quaternion_normalize(quaternion_multiply(delta, q))


def quaternion_align_sign(reference: Quaternion, candidate: Quaternion) -> Quaternion:
    if quaternion_dot(reference, candidate) < 0.0:
        return quaternion_scalar_multiply(candidate, -1.0)
    return candidate


def quaternion_to_rotation_vector(q: Quaternion) -> Vector3:
    normalized = quaternion_normalize(q)
    if normalized[3] < 0.0:
        normalized = quaternion_scalar_multiply(normalized, -1.0)

    x, y, z, w = normalized
    w = max(-1.0, min(1.0, w))
    vec_norm = math.sqrt(x * x + y * y + z * z)
    if vec_norm <= 1e-12:
        return (2.0 * x, 2.0 * y, 2.0 * z)

    angle = 2.0 * math.atan2(vec_norm, w)
    axis_scale = angle / vec_norm
    return (x * axis_scale, y * axis_scale, z * axis_scale)


def geo_to_scene_vector(v: Vector3) -> Vector3:
    return (v[0], v[2], v[1])


def _rho_thermosphere_km(altitude_km: float) -> float:
    return SPACECRAFT_REFERENCE_DENSITY_KG_M3 * math.exp(
        -(altitude_km - 500.0) / SPACECRAFT_DENSITY_SCALE_HEIGHT_KM
    )


def perturbed_orbit_elements(orbit: OrbitConfig, time_s: float) -> dict[str, float]:
    base_radius = orbit.radius_km
    base_mean_motion = orbit.mean_motion_rad_s
    inclination = math.radians(orbit.inclination_deg)
    semi_major_axis = base_radius
    eccentricity = 1e-4

    rho = _rho_thermosphere_km(orbit.altitude_km)
    orbital_speed_m_s = orbit.orbital_speed_km_s * 1000.0
    drag_area_to_mass = SPACECRAFT_DRAG_AREA_M2 / SPACECRAFT_MASS_KG
    drag_acc_m_s2 = 0.5 * SPACECRAFT_DRAG_COEFF * drag_area_to_mass * rho * orbital_speed_m_s**2
    semi_major_axis_m = semi_major_axis * 1000.0
    mu_m3_s2 = EARTH_MU_KM3_S2 * 1e9
    a_dot_m_s = -2.0 * (semi_major_axis_m**2 / mu_m3_s2) * orbital_speed_m_s * drag_acc_m_s2
    semi_major_axis = max(EARTH_RADIUS_KM + 120.0, semi_major_axis + a_dot_m_s * time_s / 1000.0)

    mean_motion = math.sqrt(EARTH_MU_KM3_S2 / semi_major_axis**3)
    p = semi_major_axis * (1.0 - eccentricity * eccentricity)
    j2_factor = 1.5 * EARTH_J2 * mean_motion * (EARTH_RADIUS_KM / p) ** 2
    raan_rate = -j2_factor * math.cos(inclination)
    argp_rate = 0.75 * EARTH_J2 * mean_motion * (EARTH_RADIUS_KM / p) ** 2 * (
        5.0 * math.cos(inclination) ** 2 - 1.0
    )

    j3_scale = EARTH_J3 / EARTH_J2
    j4_scale = EARTH_J4 / EARTH_J2
    raan_rate *= 1.0 + 0.08 * j3_scale + 0.02 * j4_scale
    argp_rate *= 1.0 + 0.12 * j3_scale + 0.05 * j4_scale

    srp_pressure = SOLAR_PRESSURE_N_M2
    srp_acc_m_s2 = srp_pressure * SPACECRAFT_SRP_COEFF * SPACECRAFT_SRP_AREA_M2 / SPACECRAFT_MASS_KG
    srp_rate = srp_acc_m_s2 / max(orbital_speed_m_s, 1.0)
    srp_bias = 0.15 * srp_rate * time_s

    anomaly = (
        math.radians(orbit.true_anomaly_deg_at_epoch)
        + mean_motion * (time_s - orbit.epoch_time_s)
        + srp_bias
    ) % (math.pi * 2.0)

    return {
        "semi_major_axis_km": semi_major_axis,
        "eccentricity": eccentricity,
        "inclination_rad": inclination,
        "raan_rad": (math.radians(orbit.raan_deg) + raan_rate * time_s) % (math.pi * 2.0),
        "arg_periapsis_rad": (argp_rate * time_s) % (math.pi * 2.0),
        "true_anomaly_rad": anomaly,
        "mean_motion_rad_s": mean_motion,
    }


def geocentric_orbit_position_km(orbit: OrbitConfig, time_s: float) -> Vector3:
    elements = perturbed_orbit_elements(orbit, time_s)
    radius = elements["semi_major_axis_km"]
    anomaly = elements["true_anomaly_rad"]
    inclination = elements["inclination_rad"]
    raan = elements["raan_rad"]
    arg_periapsis = elements["arg_periapsis_rad"]

    u = (arg_periapsis + anomaly) % (math.pi * 2.0)
    cos_raan = math.cos(raan)
    sin_raan = math.sin(raan)
    cos_u = math.cos(u)
    sin_u = math.sin(u)
    cos_i = math.cos(inclination)
    sin_i = math.sin(inclination)

    x = radius * (cos_raan * cos_u - sin_raan * sin_u * cos_i)
    y = radius * (sin_raan * cos_u + cos_raan * sin_u * cos_i)
    z = radius * (sin_u * sin_i)
    return (x, y, z)


def geocentric_to_lat_lon_alt(position_km: Vector3) -> tuple[float, float, float]:
    x, y, z = position_km
    location = EarthLocation.from_geocentric(x * u.km, y * u.km, z * u.km)
    geodetic = location.to_geodetic()
    return (
        float(geodetic.lat.to_value(u.deg)),
        float(geodetic.lon.to_value(u.deg)),
        float(geodetic.height.to_value(u.km)),
    )


def ned_components_to_scene(
    north: float,
    east: float,
    down: float,
    lat_deg: float,
    lon_deg: float,
) -> Vector3:
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)

    north_basis = (
        -math.sin(lat) * math.cos(lon),
        -math.sin(lat) * math.sin(lon),
        math.cos(lat),
    )
    east_basis = (-math.sin(lon), math.cos(lon), 0.0)
    down_basis = (
        -math.cos(lat) * math.cos(lon),
        -math.cos(lat) * math.sin(lon),
        -math.sin(lat),
    )

    world_geo = (
        north * north_basis[0] + east * east_basis[0] + down * down_basis[0],
        north * north_basis[1] + east * east_basis[1] + down * down_basis[1],
        north * north_basis[2] + east * east_basis[2] + down * down_basis[2],
    )
    return geo_to_scene_vector(world_geo)


def is_in_earth_shadow(position_geo: Vector3, sun_geo: Vector3) -> bool:
    sun_direction = vector_normalize(sun_geo)
    if vector_length(sun_direction) <= 1e-12:
        return False

    if vector_dot(position_geo, sun_direction) >= 0.0:
        return False

    shadow_distance = vector_length(vector_cross(position_geo, sun_direction))
    return shadow_distance < EARTH_RADIUS_KM


def decimal_year_for_time(time_value: Time) -> float:
    return float(time_value.decimalyear)


def orbit_true_anomaly_rad(orbit: OrbitConfig, time_s: float) -> float:
    return perturbed_orbit_elements(orbit, time_s)["true_anomaly_rad"]


class BoresightEstimator:
    def __init__(self) -> None:
        self.prev_mag_unit: Vector3 | None = None
        self.omega_estimate: Vector3 = (0.0, 0.0, 0.0)

    def reset(self) -> None:
        self.prev_mag_unit = None
        self.omega_estimate = (0.0, 0.0, 0.0)

    def update(self, dt: float, magnetic_body: Vector3) -> Vector3:
        if dt <= 1e-9:
            return self.omega_estimate

        current = vector_normalize(magnetic_body)
        if self.prev_mag_unit is None:
            self.prev_mag_unit = current
            return self.omega_estimate

        delta = vector_scale(vector_subtract(current, self.prev_mag_unit), 1.0 / dt)
        omega = vector_scale(vector_cross(self.prev_mag_unit, delta), -1.0)
        self.omega_estimate = vector_scale(vector_add(self.omega_estimate, omega), 0.5)
        self.prev_mag_unit = current
        return self.omega_estimate


class PanelAutocorrelationEstimator:
    def __init__(self, window_size: int = 32) -> None:
        self.window_size = window_size
        self.sun_history: list[Vector3] = []
        self.omega_estimate: Vector3 = (0.0, 0.0, 0.0)

    def reset(self) -> None:
        self.sun_history.clear()
        self.omega_estimate = (0.0, 0.0, 0.0)

    def _panel_to_sun_vector(self, panel_readings: dict[str, float]) -> Vector3:
        raw = np.array(
            [
                panel_readings["I_Xp"] - panel_readings["I_Xm"],
                panel_readings["I_Yp"] - panel_readings["I_Ym"],
                panel_readings["I_Zp"] - panel_readings["I_Zm"],
            ],
            dtype=float,
        )
        length = float(np.linalg.norm(raw))
        if length <= 0.0:
            return (0.0, 0.0, 0.0)
        normalized = raw / length
        return (float(normalized[0]), float(normalized[1]), float(normalized[2]))

    def update(self, dt: float, panel_readings: dict[str, float]) -> Vector3:
        if dt <= 1e-9:
            return self.omega_estimate

        sun_vector = self._panel_to_sun_vector(panel_readings)
        if vector_length(sun_vector) <= 1e-9:
            return self.omega_estimate

        self.sun_history.append(sun_vector)
        if len(self.sun_history) > self.window_size:
            self.sun_history.pop(0)

        if len(self.sun_history) < 2:
            return self.omega_estimate

        prev = self.sun_history[-2]
        current = self.sun_history[-1]
        delta = vector_scale(vector_subtract(current, prev), 1.0 / dt)

        # For a unit line-of-sight vector u in the body frame:
        #   u_dot = -omega x u
        # so the minimum-norm body-rate estimate from the panel-derived
        # sun direction is:
        #   omega_perp = -u x u_dot
        omega = vector_scale(vector_cross(current, delta), -1.0)

        # Keep the estimate continuous and damp out the remaining panel
        # quantization noise.
        if vector_dot(omega, self.omega_estimate) < 0.0:
            omega = vector_scale(omega, -1.0)

        blend = 0.28
        self.omega_estimate = vector_add(
            vector_scale(self.omega_estimate, 1.0 - blend),
            vector_scale(omega, blend),
        )
        return self.omega_estimate


class EkfAttitudeEstimator:
    def __init__(self) -> None:
        self.q_nominal: Quaternion = quaternion_identity()
        self.omega_nominal: Vector3 = (0.0, 0.0, 0.0)
        self.covariance = np.diag([0.08, 0.08, 0.08, 0.03, 0.03, 0.03]).astype(float)
        self.prev_measurement: Quaternion | None = None
        self.prev_omega_measurement: Vector3 | None = None

    def reset(self, attitude: Quaternion) -> None:
        self.q_nominal = quaternion_normalize(attitude)
        self.omega_nominal = (0.0, 0.0, 0.0)
        self.covariance = np.diag([0.08, 0.08, 0.08, 0.03, 0.03, 0.03]).astype(float)
        self.prev_measurement = None
        self.prev_omega_measurement = None

    def _predict(self, dt: float) -> None:
        if dt <= 1e-9:
            return

        self.q_nominal = quaternion_rk4_step(self.q_nominal, self.omega_nominal, dt)
        wx, wy, wz = self.omega_nominal
        omega_skew = matrix_skew((wx, wy, wz))
        f_theta = np.eye(3) - omega_skew * dt
        f_omega = np.eye(3) * dt
        f = np.block(
            [
                [f_theta, f_omega],
                [np.zeros((3, 3)), np.eye(3)],
            ]
        )
        q = np.diag([3e-4, 3e-4, 3e-4, 1.5e-4, 1.5e-4, 1.5e-4])
        self.covariance = f @ self.covariance @ f.T + q

    def _build_measurement_quaternion(
        self,
        magnetic_body: Vector3,
        sun_body: Vector3,
        magnetic_scene: Vector3,
        sun_scene: Vector3,
    ) -> Quaternion | None:
        body1 = vector_normalize(magnetic_body)
        body2 = vector_normalize(sun_body)
        ref1 = vector_normalize(magnetic_scene)
        ref2 = vector_normalize(sun_scene)

        if vector_length(body1) <= 1e-9 or vector_length(body2) <= 1e-9:
            return None
        if vector_length(ref1) <= 1e-9 or vector_length(ref2) <= 1e-9:
            return None

        body_cross = vector_cross(body1, body2)
        ref_cross = vector_cross(ref1, ref2)
        if vector_length(body_cross) <= 1e-6 or vector_length(ref_cross) <= 1e-6:
            return None

        def basis(a: Vector3, b: Vector3) -> np.ndarray:
            e1 = np.array(vector_normalize(a), dtype=float)
            cross = np.array(vector_cross(a, b), dtype=float)
            cross_norm = float(np.linalg.norm(cross))
            if cross_norm <= 1e-12:
                raise ValueError("Degenerate basis")
            e2 = cross / cross_norm
            e3 = np.cross(e1, e2)
            return np.column_stack([e1, e2, e3])

        try:
            body_basis = basis(body1, body2)
            ref_basis = basis(ref1, ref2)
        except ValueError:
            return None

        c_bi = body_basis @ ref_basis.T
        c_ib = c_bi.T
        return rotation_matrix_to_quaternion(c_ib)

    def _predict_omega_from_measurements(
        self,
        q_measurement: Quaternion,
        dt: float,
    ) -> Vector3 | None:
        if self.prev_measurement is None or dt <= 1e-9:
            self.prev_measurement = q_measurement
            return None

        aligned_current = quaternion_align_sign(self.prev_measurement, q_measurement)
        delta = quaternion_multiply(quaternion_conjugate(self.prev_measurement), aligned_current)
        omega_meas = quaternion_to_rotation_vector(delta)
        omega_meas = vector_scale(omega_meas, 1.0 / dt)
        self.prev_measurement = q_measurement
        if self.prev_omega_measurement is None:
            self.prev_omega_measurement = omega_meas
            return omega_meas

        if vector_dot(omega_meas, self.prev_omega_measurement) < 0.0:
            omega_meas = vector_scale(omega_meas, -1.0)

        omega_blend = 0.25
        omega_meas = vector_add(
            vector_scale(self.prev_omega_measurement, 1.0 - omega_blend),
            vector_scale(omega_meas, omega_blend),
        )
        self.prev_omega_measurement = omega_meas
        return omega_meas

    def update(
        self,
        dt: float,
        magnetic_body: Vector3,
        sun_body: Vector3,
        magnetic_scene: Vector3,
        sun_scene: Vector3,
    ) -> tuple[Quaternion, Vector3]:
        self._predict(dt)
        q_meas = self._build_measurement_quaternion(magnetic_body, sun_body, magnetic_scene, sun_scene)
        if q_meas is None:
            return self.q_nominal, self.omega_nominal

        q_meas = quaternion_align_sign(self.q_nominal, q_meas)
        q_err = quaternion_multiply(quaternion_conjugate(self.q_nominal), q_meas)
        if q_err[3] < 0.0:
            q_err = quaternion_scalar_multiply(q_err, -1.0)
        attitude_residual = np.array([2.0 * q_err[0], 2.0 * q_err[1], 2.0 * q_err[2]], dtype=float)

        omega_meas = self._predict_omega_from_measurements(q_meas, dt)
        if omega_meas is None:
            h_mat = np.block([[np.eye(3), np.zeros((3, 3))]])
            residual_vec = attitude_residual.reshape((-1, 1))
            r_mat = np.eye(3, dtype=float) * 0.02
        else:
            h_mat = np.eye(6, dtype=float)
            omega_residual = np.array(
                [
                    omega_meas[0] - self.omega_nominal[0],
                    omega_meas[1] - self.omega_nominal[1],
                    omega_meas[2] - self.omega_nominal[2],
                ],
                dtype=float,
            )
            residual_vec = np.concatenate([attitude_residual, omega_residual]).reshape((-1, 1))
            r_mat = np.diag([0.02, 0.02, 0.02, 0.08, 0.08, 0.08]).astype(float)

        s_mat = h_mat @ self.covariance @ h_mat.T + r_mat
        k_gain = self.covariance @ h_mat.T @ np.linalg.inv(s_mat)
        dx = (k_gain @ residual_vec).reshape((-1,))

        dtheta = (float(dx[0]), float(dx[1]), float(dx[2]))
        delta_q = quaternion_from_axis_angle(dtheta, vector_length(dtheta))
        self.q_nominal = quaternion_multiply(self.q_nominal, delta_q)
        self.q_nominal = quaternion_normalize(self.q_nominal)
        self.q_nominal = quaternion_slerp(self.q_nominal, q_meas, 0.12)

        self.omega_nominal = vector_add(
            self.omega_nominal,
            (
                float(dx[3]) if len(dx) > 3 else 0.0,
                float(dx[4]) if len(dx) > 4 else 0.0,
                float(dx[5]) if len(dx) > 5 else 0.0,
            ),
        )
        if omega_meas is not None:
            self.omega_nominal = vector_add(
                vector_scale(self.omega_nominal, 0.82),
                vector_scale(omega_meas, 0.18),
            )

        identity = np.eye(self.covariance.shape[0])
        self.covariance = (identity - k_gain @ h_mat) @ self.covariance
        return self.q_nominal, self.omega_nominal


class AttitudeEstimator:
    def __init__(self, initial_attitude: Quaternion, method: EstimatorMethod = "ekf") -> None:
        self.method: EstimatorMethod = method
        self.last_time_s: float | None = None
        self.boresight = BoresightEstimator()
        self.panels = PanelAutocorrelationEstimator()
        self.ekf = EkfAttitudeEstimator()
        self.ekf.reset(initial_attitude)

    def set_method(self, method: EstimatorMethod) -> None:
        self.method = method

    def reset_histories(self, attitude: Quaternion, time_s: float) -> None:
        self.last_time_s = time_s
        self.boresight.reset()
        self.panels.reset()
        self.ekf.reset(attitude)

    def update(
        self,
        time_s: float,
        magnetic_body: Vector3,
        sun_body: Vector3,
        magnetic_scene: Vector3,
        sun_scene: Vector3,
        true_attitude: Quaternion,
        true_omega: Vector3,
        panel_readings: dict[str, float],
    ) -> dict[str, Any]:
        if self.last_time_s is None:
            self.reset_histories(true_attitude, time_s)
        dt = max(0.0, time_s - (self.last_time_s or time_s))
        self.last_time_s = time_s

        omega_boresight = self.boresight.update(dt, magnetic_body)
        omega_panels = self.panels.update(dt, panel_readings)
        q_ekf, omega_ekf = self.ekf.update(dt, magnetic_body, sun_body, magnetic_scene, sun_scene)

        if self.method == "boresight":
            omega_est = omega_boresight
        elif self.method == "panels":
            omega_est = omega_panels
        else:
            omega_est = omega_ekf

        q_error_angle = quaternion_error_angle_deg(true_attitude, q_ekf)
        omega_error = vector_subtract(omega_est, true_omega)
        return {
            "estimatorMethod": self.method,
            "omegaEstimated": omega_est,
            "omegaError": omega_error,
            "qEstimated": q_ekf,
            "qErrorAngleDeg": q_error_angle,
        }


class SatelliteSimulation:
    def __init__(self, orbit: OrbitConfig) -> None:
        self.orbit = orbit
        self.sim_time_s = 0.0
        self.time_scale = 1.0
        self.paused = False
        self.attitude = quaternion_identity()
        self.omega_body: Vector3 = OMEGA_BODY_RAD_S
        self.start_time = Time.now()
        self.estimator = AttitudeEstimator(self.attitude, "ekf")
        self.rng = random.Random(0x5A17A11E)
        self._lock = asyncio.Lock()
        self._latest_payload = self._build_payload()

    def _time_to_astropy(self, time_s: float) -> Time:
        return self.start_time + time_s * u.s

    def _integrate_attitude(self, delta_s: float) -> None:
        if abs(delta_s) <= 0.0:
            return

        remaining = delta_s
        step = SIM_STEP_SECONDS if remaining > 0.0 else -SIM_STEP_SECONDS
        while abs(remaining) > 1e-12:
            dt = step if abs(remaining) >= SIM_STEP_SECONDS else remaining
            self.attitude = quaternion_rk4_step(self.attitude, self.omega_body, dt)
            remaining -= dt

    def _advance_time(self, sim_dt: float) -> None:
        if abs(sim_dt) <= 0.0:
            return

        remaining = sim_dt
        while abs(remaining) > 1e-12:
            dt = SIM_STEP_SECONDS if abs(remaining) >= SIM_STEP_SECONDS else remaining
            self.attitude = quaternion_rk4_step(self.attitude, self.omega_body, dt)
            self.sim_time_s += dt
            remaining -= dt

    def _reseed_state_after_configuration_change(self) -> None:
        self.estimator.reset_histories(self.attitude, self.sim_time_s)
        self._latest_payload = self._build_payload()

    def _build_payload(self) -> dict[str, Any]:
        time_value = self._time_to_astropy(self.sim_time_s)
        position_geo = geocentric_orbit_position_km(self.orbit, self.sim_time_s)
        orbit_elements = perturbed_orbit_elements(self.orbit, self.sim_time_s)
        lat_deg, lon_deg, alt_km = geocentric_to_lat_lon_alt(position_geo)
        position_scene = geo_to_scene_vector(position_geo)

        sun_geo = tuple(float(component) for component in get_sun(time_value).cartesian.xyz.to_value(u.km))
        sun_scene = geo_to_scene_vector(sun_geo)
        sun_direction_scene = vector_normalize(vector_sub(sun_scene, position_scene))
        in_earth_shadow = is_in_earth_shadow(position_geo, sun_geo)

        _, _, _, igrf_x, igrf_y, igrf_z, _ = pyIGRF14.igrf_value(
            lat_deg,
            lon_deg,
            alt_km,
            decimal_year_for_time(time_value),
        )
        magnetic_scene = ned_components_to_scene(igrf_x, igrf_y, igrf_z, lat_deg, lon_deg)

        sun_distance_km = max(vector_length(vector_sub(sun_geo, position_geo)), 1.0)
        solar_constant = SOLAR_CONSTANT_W_M2 * (ASTRONOMICAL_UNIT_KM / sun_distance_km) ** 2

        sun_body = quaternion_rotate_vector(quaternion_conjugate(self.attitude), sun_direction_scene)
        magnetic_body = quaternion_rotate_vector(quaternion_conjugate(self.attitude), magnetic_scene)
        magnetic_body = (
            magnetic_body[0] + self.rng.gauss(0.0, SPACECRAFT_MAGNETOMETER_NOISE_NT),
            magnetic_body[1] + self.rng.gauss(0.0, SPACECRAFT_MAGNETOMETER_NOISE_NT),
            magnetic_body[2] + self.rng.gauss(0.0, SPACECRAFT_MAGNETOMETER_NOISE_NT),
        )

        panel_normals = {
            "I_Xp": (1.0, 0.0, 0.0),
            "I_Xm": (-1.0, 0.0, 0.0),
            "I_Yp": (0.0, 1.0, 0.0),
            "I_Ym": (0.0, -1.0, 0.0),
            "I_Zp": (0.0, 0.0, 1.0),
            "I_Zm": (0.0, 0.0, -1.0),
        }
        panel_readings = {
            face: (
                0.0
                if in_earth_shadow
                else max(0.0, vector_dot(sun_body, normal))
                * solar_constant
                * max(
                    0.0,
                    1.0
                    + self.rng.gauss(0.0, SPACECRAFT_PANEL_RELATIVE_NOISE)
                    + self.rng.gauss(0.0, SPACECRAFT_PANEL_NOISE_W_M2) / max(solar_constant, 1.0),
                )
            )
            for face, normal in panel_normals.items()
        }

        true_anomaly_rad = orbit_elements["true_anomaly_rad"]
        true_anomaly_deg = math.degrees(true_anomaly_rad) % 360.0
        mean_anomaly_deg = true_anomaly_deg
        arg_periapsis_deg = math.degrees(orbit_elements["arg_periapsis_rad"]) % 360.0

        # Вычисление скорости (км/с) для круговой орбиты
        speed = math.sqrt(EARTH_MU_KM3_S2 / orbit_elements["semi_major_axis_km"])
        nu = true_anomaly_rad                     # уже есть
        incl_rad = orbit_elements["inclination_rad"]
        raan_rad = orbit_elements["raan_rad"]

        cos_raan = math.cos(raan_rad)
        sin_raan = math.sin(raan_rad)
        cos_i = math.cos(incl_rad)
        sin_i = math.sin(incl_rad)
        cos_nu = math.cos(nu)
        sin_nu = math.sin(nu)

        vx = speed * ( -cos_raan * sin_nu - sin_raan * cos_nu * cos_i )
        vy = speed * ( -sin_raan * sin_nu + cos_raan * cos_nu * cos_i )
        vz = speed * ( cos_nu * sin_i )

        omega_vector = self.estimator.update(
            self.sim_time_s,
            magnetic_body,
            sun_body,
            magnetic_scene,
            sun_direction_scene,
            self.attitude,
            self.omega_body,
            panel_readings,
        )
        omega_estimated = omega_vector["omegaEstimated"]
        omega_error = omega_vector["omegaError"]
        q_estimated = omega_vector["qEstimated"]

        payload: dict[str, Any] = {
            "type": "state",
            "time": round(self.sim_time_s, 6),
            "x": float(position_geo[0]),
            "y": float(position_geo[1]),
            "z": float(position_geo[2]),
            "vx": float(vx),         
            "vy": float(vy),          
            "vz": float(vz),          
            "qx": float(self.attitude[0]),
            "qy": float(self.attitude[1]),
            "qz": float(self.attitude[2]),
            "qw": float(self.attitude[3]),
            "omegaX": self.omega_body[0],
            "omegaY": self.omega_body[1],
            "omegaZ": self.omega_body[2],
            "estimatorMethod": omega_vector["estimatorMethod"],
            "omegaEstimatedX": float(omega_estimated[0]),
            "omegaEstimatedY": float(omega_estimated[1]),
            "omegaEstimatedZ": float(omega_estimated[2]),
            "omegaErrorX": float(omega_error[0]),
            "omegaErrorY": float(omega_error[1]),
            "omegaErrorZ": float(omega_error[2]),
            "qEstimatedX": float(q_estimated[0]),
            "qEstimatedY": float(q_estimated[1]),
            "qEstimatedZ": float(q_estimated[2]),
            "qEstimatedW": float(q_estimated[3]),
            "qErrorAngleDeg": float(omega_vector["qErrorAngleDeg"]),
            "Bx": float(magnetic_body[0]),
            "By": float(magnetic_body[1]),
            "Bz": float(magnetic_body[2]),
            "I_Xp": float(panel_readings["I_Xp"]),
            "I_Xm": float(panel_readings["I_Xm"]),
            "I_Yp": float(panel_readings["I_Yp"]),
            "I_Ym": float(panel_readings["I_Ym"]),
            "I_Zp": float(panel_readings["I_Zp"]),
            "I_Zm": float(panel_readings["I_Zm"]),
            "altitudeKm": orbit_elements["semi_major_axis_km"] - EARTH_RADIUS_KM,
            "semiMajorAxisKm": orbit_elements["semi_major_axis_km"],
            "eccentricity": orbit_elements["eccentricity"],
            "inclinationDeg": self.orbit.inclination_deg,
            "raanDeg": math.degrees(raan_rad) % 360.0,
            "argPeriapsisDeg": arg_periapsis_deg,
            "meanAnomalyDeg": mean_anomaly_deg,
            "trueAnomalyDeg": true_anomaly_deg,
            "trueAnomalyRad": true_anomaly_rad,
            "meanMotionRadPerS": orbit_elements["mean_motion_rad_s"],
            "orbitalSpeedKmPerS": speed,
            "radiusKm": orbit_elements["semi_major_axis_km"],
            "periodSeconds": (2.0 * math.pi) / orbit_elements["mean_motion_rad_s"],
        }

        return payload

    async def step(self) -> dict[str, Any]:
        async with self._lock:
            if not self.paused:
                self._advance_time(REAL_STEP_SECONDS * self.time_scale)
            self._latest_payload = self._build_payload()
            return self._latest_payload

    async def sync(self, payload: dict[str, Any]) -> None:
        async with self._lock:
            time_value = payload.get("time")
            if isinstance(time_value, (int, float)) and math.isfinite(float(time_value)):
                next_time = float(time_value)
                delta = next_time - self.sim_time_s
                if abs(delta) > 1e-12:
                    self._integrate_attitude(delta)
                self.sim_time_s = next_time

            time_scale = payload.get("timeScale")
            if isinstance(time_scale, (int, float)) and math.isfinite(float(time_scale)):
                self.time_scale = max(0.0, float(time_scale))

            paused = payload.get("paused")
            if isinstance(paused, bool):
                self.paused = paused

            self._latest_payload = self._build_payload()

    async def set_estimator_method(self, method: EstimatorMethod) -> None:
        async with self._lock:
            self.estimator.set_method(method)
            self._latest_payload = self._build_payload()

    async def set_body_rate(self, omega_x: float, omega_y: float, omega_z: float) -> None:
        async with self._lock:
            self.omega_body = (float(omega_x), float(omega_y), float(omega_z))
            self._reseed_state_after_configuration_change()

    async def set_orbit(self, payload: dict[str, Any]) -> None:
        async with self._lock:
            altitude = payload.get("altitudeKm", self.orbit.altitude_km)
            inclination = payload.get("inclinationDeg", self.orbit.inclination_deg)
            raan = payload.get("raanDeg", self.orbit.raan_deg)
            true_anomaly = payload.get("trueAnomalyDeg", self.orbit.true_anomaly_deg_at_epoch)
            epoch_time_s = payload.get("epochTimeS", self.sim_time_s)
            if not all(
                isinstance(value, (int, float)) and math.isfinite(float(value))
                for value in (altitude, inclination, raan, true_anomaly, epoch_time_s)
            ):
                return

            self.orbit = OrbitConfig(
                altitude_km=max(120.0, float(altitude)),
                inclination_deg=float(inclination),
                raan_deg=float(raan),
                true_anomaly_deg_at_epoch=float(true_anomaly),
                epoch_time_s=float(epoch_time_s),
            )
            self._reseed_state_after_configuration_change()

    async def get_latest_payload(self) -> dict[str, Any]:
        async with self._lock:
            return self._latest_payload


class WebSocketConnection:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.reader = reader
        self.writer = writer

    async def handshake(self) -> None:
        request = await self.reader.readuntil(b"\r\n\r\n")
        headers = parse_http_headers(request.decode("utf-8", errors="replace"))
        key = headers.get("sec-websocket-key")
        if not key:
            raise ValueError("Missing Sec-WebSocket-Key")

        accept = base64.b64encode(hashlib.sha1((key + WEBSOCKET_GUID).encode()).digest()).decode()
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n"
            "\r\n"
        )
        self.writer.write(response.encode("ascii"))
        await self.writer.drain()

    async def send_text(self, message: str) -> None:
        data = message.encode("utf-8")
        length = len(data)
        header = bytearray([0x81])
        if length < 126:
            header.append(length)
        elif length <= 0xFFFF:
            header.append(126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(127)
            header.extend(struct.pack("!Q", length))
        self.writer.write(bytes(header) + data)
        await self.writer.drain()

    async def send_json(self, payload: dict[str, Any]) -> None:
        await self.send_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))

    async def receive_text(self) -> str | None:
        first = await self.reader.readexactly(2)
        opcode = first[0] & 0x0F
        masked = (first[1] & 0x80) != 0
        length = first[1] & 0x7F
        if length == 126:
            length = struct.unpack("!H", await self.reader.readexactly(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", await self.reader.readexactly(8))[0]

        mask = await self.reader.readexactly(4) if masked else b""
        payload = await self.reader.readexactly(length) if length else b""
        if masked:
            payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))

        if opcode == 0x8:
            return None
        if opcode == 0x9:
            await self._send_control_frame(0xA, payload)
            return ""
        if opcode != 0x1:
            return ""
        return payload.decode("utf-8")

    async def _send_control_frame(self, opcode: int, payload: bytes) -> None:
        if len(payload) > 125:
            return
        self.writer.write(bytes([0x80 | opcode, len(payload)]) + payload)
        await self.writer.drain()

    async def close(self) -> None:
        try:
            self.writer.close()
            await self.writer.wait_closed()
        except (ConnectionError, ConnectionResetError, OSError):
            pass


@dataclass(eq=False)
class ClientSession:
  connection: WebSocketConnection
  queue: asyncio.Queue[str]


def parse_http_headers(raw_request: str) -> dict[str, str]:
    lines = raw_request.split("\r\n")
    headers: dict[str, str] = {}
    for line in lines[1:]:
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()
    return headers


class BroadcastServer:
    def __init__(self, simulation: SatelliteSimulation) -> None:
        self.simulation = simulation
        self.clients: set[ClientSession] = set()
        self._clients_lock = asyncio.Lock()
        self._stop_event = asyncio.Event()

    async def add_client(self, session: ClientSession) -> None:
        async with self._clients_lock:
            self.clients.add(session)

    async def remove_client(self, session: ClientSession) -> None:
        async with self._clients_lock:
            self.clients.discard(session)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        message = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        async with self._clients_lock:
            sessions = list(self.clients)

        for session in sessions:
            try:
                if session.queue.full():
                    session.queue.get_nowait()
                session.queue.put_nowait(message)
            except asyncio.QueueFull:
                continue

    async def tick_loop(self) -> None:
        while not self._stop_event.is_set():
            await asyncio.sleep(REAL_STEP_SECONDS)
            payload = await self.simulation.step()
            await self.broadcast(payload)

    async def run_connection(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        connection = WebSocketConnection(reader, writer)
        session = ClientSession(connection=connection, queue=asyncio.Queue(maxsize=4))
        try:
            await connection.handshake()
            await self.add_client(session)
            await session.queue.put(
                json.dumps(await self.simulation.get_latest_payload(), separators=(",", ":"), ensure_ascii=False)
            )

            sender = asyncio.create_task(self._send_loop(session))
            receiver = asyncio.create_task(self._receive_loop(session))
            done, pending = await asyncio.wait(
                {sender, receiver},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            for task in done:
                task.result()
        except (asyncio.IncompleteReadError, ConnectionError, OSError, ValueError):
            pass
        finally:
            await self.remove_client(session)
            await connection.close()

    async def _send_loop(self, session: ClientSession) -> None:
        while True:
            message = await session.queue.get()
            await session.connection.send_text(message)

    async def _receive_loop(self, session: ClientSession) -> None:
        while True:
            message = await session.connection.receive_text()
            if message is None:
                return
            if not message:
                continue
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue

            message_type = payload.get("type")
            if message_type == "sync":
                await self.simulation.sync(payload)
                await self.broadcast(await self.simulation.get_latest_payload())
            elif message_type == "set_estimator":
                method = payload.get("method")
                if method in ("boresight", "panels", "ekf"):
                    await self.simulation.set_estimator_method(method)
                    await self.broadcast(await self.simulation.get_latest_payload())
            elif message_type == "set_orbit":
                await self.simulation.set_orbit(payload)
                await self.broadcast(await self.simulation.get_latest_payload())
            elif message_type == "set_body_rate":
                omega_x = payload.get("omegaX")
                omega_y = payload.get("omegaY")
                omega_z = payload.get("omegaZ")
                if all(isinstance(value, (int, float)) and math.isfinite(float(value)) for value in (omega_x, omega_y, omega_z)):
                    await self.simulation.set_body_rate(float(omega_x), float(omega_y), float(omega_z))
                    await self.broadcast(await self.simulation.get_latest_payload())

    async def run(self, host: str, port: int) -> None:
        server = await asyncio.start_server(self.run_connection, host, port)
        addresses = ", ".join(str(sock.getsockname()) for sock in server.sockets or [])
        print(f"Satellite WebSocket server listening on {addresses}", flush=True)
        tick_task = asyncio.create_task(self.tick_loop())
        try:
            async with server:
                await server.serve_forever()
        finally:
            self._stop_event.set()
            tick_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await tick_task


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Circular Earth satellite WebSocket server.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    simulation = SatelliteSimulation(OrbitConfig())
    server = BroadcastServer(simulation)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    def handle_loop_exception(loop: asyncio.AbstractEventLoop, context: dict[str, Any]) -> None:
        exception = context.get("exception")
        message = context.get("message", "")

        if isinstance(exception, ConnectionResetError):
          return
        if isinstance(exception, OSError) and getattr(exception, "winerror", None) == 10054:
            return
        if "_call_connection_lost" in message and isinstance(exception, OSError):
            if getattr(exception, "winerror", None) == 10054:
                return

        loop.default_exception_handler(context)

    loop.set_exception_handler(handle_loop_exception)
    for signame in ("SIGINT", "SIGTERM"):
        sig = getattr(signal, signame, None)
        if sig is not None:
            try:
                loop.add_signal_handler(sig, loop.stop)
            except NotImplementedError:
                pass
    try:
        loop.run_until_complete(server.run(args.host, args.port))
    except KeyboardInterrupt:
        pass
    finally:
        loop.close()


if __name__ == "__main__":
    main()

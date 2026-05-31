import os

def collect_src_files(src_dir="src", output_file="output.txt"):
    """
    Рекурсивно обходит папку src_dir, читает все файлы и сохраняет их содержимое
    в output_file с заголовками в виде *относительный_путь*.
    """
    if not os.path.isdir(src_dir):
        print(f"Ошибка: папка '{src_dir}' не найдена в текущей директории.")
        return

    with open(output_file, "w", encoding="utf-8") as out:
        for root, dirs, files in os.walk(src_dir):
            for file in files:
                file_path = os.path.join(root, file)
                # Относительный путь от src_dir (например, "subfolder/file.txt")
                rel_path = os.path.relpath(file_path, src_dir)

                # Записываем заголовок
                out.write(f"*{rel_path}*\n")

                # Пытаемся прочитать файл как текст (UTF-8)
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        content = f.read()
                    out.write(content)
                except UnicodeDecodeError:
                    # Если файл бинарный – пишем предупреждение
                    out.write("[Невозможно прочитать как текст: бинарный файл]\n")
                except Exception as e:
                    out.write(f"[Ошибка чтения файла: {e}]\n")

                # Добавляем пустую строку между файлами для читаемости
                out.write("\n")

    print(f"Готово. Результат сохранён в '{output_file}'")

if __name__ == "__main__":
    collect_src_files()
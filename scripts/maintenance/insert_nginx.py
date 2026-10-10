"""Mantenimiento: inserta el snippet de nginx dentro de una config existente.

Inserta el contenido del snippet justo antes de la primera linea
`location / {` de la config destino.

Uso:
    python scripts/maintenance/insert_nginx.py <config_destino> <snippet>

Ejemplo:
    python scripts/maintenance/insert_nginx.py \
        /etc/nginx/conf.d/site.conf circuito-web/nginx_circuito.conf
"""
import sys
from pathlib import Path


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    target = Path(sys.argv[1])
    snippet = Path(sys.argv[2]).read_text(encoding="utf-8")

    lines = target.read_text(encoding="utf-8").splitlines(keepends=True)
    out = []
    inserted = False
    for line in lines:
        if not inserted and line.strip() == "location / {":
            out.append(snippet)
            inserted = True
        out.append(line)

    target.write_text("".join(out), encoding="utf-8")
    print("inserted:", inserted)


if __name__ == "__main__":
    main()

"""Extrai símbolos de Python usando a AST padrão, sem executar o código analisado."""
import ast
import hashlib
import json
import sys


def calls(node):
    names = set()
    for part in ast.walk(node):
        if isinstance(part, ast.Call):
            target = part.func
            if isinstance(target, ast.Name):
                names.add(target.id)
            elif isinstance(target, ast.Attribute):
                names.add(target.attr)
    return sorted(names)


def unit(key, kind, node):
    body = node.body if hasattr(node, "body") else node
    dump = ast.dump(ast.Module(body=body, type_ignores=[]), include_attributes=False) if isinstance(body, list) else ast.dump(body, include_attributes=False)
    return {
        "key": key,
        "kind": kind,
        "line": node.lineno,
        "endLine": node.end_lineno,
        "fingerprint": hashlib.sha256(dump.encode("utf-8")).hexdigest(),
        "calls": calls(node),
    }


def main():
    tree = ast.parse(sys.stdin.read())
    units = []
    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            units.append(unit(f"class:{node.name}", "class", node))
            for child in node.body:
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    units.append(unit(f"method:{node.name}.{child.name}", "method", child))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            units.append(unit(f"function:{node.name}", "function", node))
    print(json.dumps({"language": "Python", "units": units, "features": []}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except SyntaxError as exc:
        print(json.dumps({"error": f"Python: linha {exc.lineno}: {exc.msg}"}))
        raise SystemExit(2)

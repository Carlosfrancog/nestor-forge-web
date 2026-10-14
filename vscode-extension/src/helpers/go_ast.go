package main

import (
    "bytes"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "go/ast"
    "go/format"
    "go/parser"
    "go/token"
    "io"
    "os"
)

type Unit struct {
    Key string `json:"key"`
    Kind string `json:"kind"`
    Line int `json:"line"`
    EndLine int `json:"endLine"`
    Fingerprint string `json:"fingerprint"`
    Calls []string `json:"calls"`
}

type Result struct {
    Language string `json:"language"`
    Units []Unit `json:"units"`
    Features []string `json:"features"`
}

func name(expr ast.Expr) string {
    switch value := expr.(type) {
    case *ast.Ident: return value.Name
    case *ast.StarExpr: return name(value.X)
    case *ast.SelectorExpr: return name(value.X) + "." + value.Sel.Name
    default: return ""
    }
}

func makeUnit(fset *token.FileSet, key, kind string, node ast.Node) Unit {
    var buffer bytes.Buffer
    _ = format.Node(&buffer, fset, node)
    digest := sha256.Sum256(buffer.Bytes())
    seen := map[string]bool{}
    ast.Inspect(node, func(part ast.Node) bool {
        call, ok := part.(*ast.CallExpr)
        if ok {
            value := name(call.Fun)
            if value != "" { seen[value] = true }
        }
        return true
    })
    calls := make([]string, 0, len(seen))
    for value := range seen { calls = append(calls, value) }
    return Unit{key, kind, fset.Position(node.Pos()).Line, fset.Position(node.End()).Line, hex.EncodeToString(digest[:]), calls}
}

func main() {
    source, err := io.ReadAll(os.Stdin)
    if err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(2) }
    fset := token.NewFileSet()
    file, err := parser.ParseFile(fset, "input.go", source, parser.AllErrors)
    if err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(2) }
    result := Result{Language: "Go", Units: []Unit{}, Features: []string{}}
    for _, declaration := range file.Decls {
        switch node := declaration.(type) {
        case *ast.FuncDecl:
            key := "function:" + node.Name.Name
            kind := "function"
            if node.Recv != nil && len(node.Recv.List) > 0 {
                key = "method:" + name(node.Recv.List[0].Type) + "." + node.Name.Name
                kind = "method"
            }
            result.Units = append(result.Units, makeUnit(fset, key, kind, node))
        case *ast.GenDecl:
            for _, item := range node.Specs {
                if spec, ok := item.(*ast.TypeSpec); ok {
                    result.Units = append(result.Units, makeUnit(fset, "type:" + spec.Name.Name, "type", spec))
                }
            }
        }
    }
    _ = json.NewEncoder(os.Stdout).Encode(result)
}

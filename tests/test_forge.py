import unittest

from forge import build_report, derive, normalize_spec, render_agent


def base_spec():
    return {
        "profile": "reader",
        "name": "Auditor",
        "role": "um auditor de código",
        "mission": "verificar tokens de autenticação",
        "code_rules": ["Verificar autenticação por rota"],
        "analysis_pipeline": ["Mapear rotas", "Validar evidências"],
        "permissions": {
            "read_code": True,
            "run_analysis_tools": False,
            "run_active_tests": False,
            "write_code": False,
        },
    }


class ForgeOutputTests(unittest.TestCase):
    def test_read_only_auditor_keeps_code_checks_and_permissions(self):
        spec = normalize_spec(base_spec())
        derived = derive(spec)
        agent = render_agent(spec, derived)
        report = build_report(spec, derived)

        self.assertIn("Verificar autenticação por rota", agent)
        self.assertIn("não deve alterar arquivos", agent)
        self.assertIn("Executar ferramentas de análise: não permitido", agent)
        self.assertIn("Executar testes ativos: exige autorização", agent)
        self.assertEqual(derived["analysis_pipeline"], ["Mapear rotas", "Validar evidências"])
        self.assertIn("Verificar autenticação por rota", report)
        self.assertIn("Validar evidências", report)

    def test_authentication_tokens_do_not_force_json(self):
        spec = normalize_spec(base_spec())
        derived = derive(spec)

        self.assertFalse(derived["traits"]["token_economy"])
        self.assertEqual(derived["output_contract"]["preferred"], "markdown")

    def test_explicit_output_contract_and_list_cleanup(self):
        raw = base_spec()
        raw["output_contract"] = {
            "preferred": "json",
            "machine_readable": True,
            "required_fields": ["• Evidências", "2. Impacto"],
        }
        spec = normalize_spec(raw)
        derived = derive(spec)
        agent = render_agent(spec, derived)

        self.assertEqual(derived["output_contract"]["required_fields"], ["Evidências", "Impacto"])
        self.assertIn("Formato preferencial: **JSON**", agent)
        self.assertIn("- Evidências", agent)
        self.assertIn("- Impacto", agent)


if __name__ == "__main__":
    unittest.main()

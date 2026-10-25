"""Документация не должна расходиться с кодом: SQL в плане проекта повторяет scripts/schema.sql дословно."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_plan_embeds_current_schema_verbatim():
    schema = (ROOT / "scripts" / "schema.sql").read_text(encoding="utf-8").strip()
    plan = (ROOT / "docs" / "plan.md").read_text(encoding="utf-8")
    assert schema in plan, (
        "SQL в docs/plan.md (шаг 1) отличается от scripts/schema.sql: обнови блок в плане, верить нужно файлу"
    )


def test_plan_mentions_every_table_in_schema():
    schema = (ROOT / "scripts" / "schema.sql").read_text(encoding="utf-8")
    plan = (ROOT / "docs" / "plan.md").read_text(encoding="utf-8")
    for line in schema.splitlines():
        if line.startswith("CREATE TABLE IF NOT EXISTS "):
            table = line.split()[5]
            assert f"`{table}`" in plan, f"таблица {table} не описана в docs/plan.md"


def test_plan_lists_every_backend_module():
    plan = (ROOT / "docs" / "plan.md").read_text(encoding="utf-8")
    for module in sorted((ROOT / "backend").glob("*.py")):
        if module.name != "__init__.py":
            assert module.name in plan, f"backend/{module.name} не упомянут в docs/plan.md (раздел 2.1)"
    for provider in sorted((ROOT / "backend" / "enrich").glob("*.py")):
        if provider.name != "__init__.py":
            assert provider.stem in plan, f"backend/enrich/{provider.name} не упомянут в docs/plan.md"


def test_requirements_in_plan_match_the_file():
    plan = (ROOT / "docs" / "plan.md").read_text(encoding="utf-8")
    for line in (ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.startswith(("#", "-")):
            assert line.strip() in plan, f"зависимость {line.strip()} не отражена в docs/plan.md (раздел 2.2)"

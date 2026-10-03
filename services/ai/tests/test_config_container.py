"""The service must start when the code is not inside the repo tree (the Docker images keep it at /app/app/config.py)."""

import importlib
import sys
from pathlib import PurePosixPath, Path

import app.config as config


def test_config_imports_when_the_file_has_no_fourth_parent(monkeypatch):
    shallow = PurePosixPath("/app/app/config.py")  # parents: /app/app, /app, /  -> three, so parents[3] raised IndexError

    class FakePath(type(Path())):
        def resolve(self, *args, **kwargs):
            return shallow

    monkeypatch.setattr(config, "Path", FakePath)
    reloaded = importlib.reload(config)
    try:
        assert reloaded.REPO_ENV_FILE.name == ".env"
        reloaded.Settings()  # constructing the settings must not fail either
    finally:
        monkeypatch.undo()
        importlib.reload(sys.modules["app.config"])

"""
LiteLLM Proxy Runner for PromptLab
Runs LiteLLM in stateless gateway mode (as configured in docker-compose.yml).
Prevents cwd .env DATABASE_URL from triggering unneeded database migrations inside the gateway.
Handles Windows Unicode console encoding for LiteLLM banner.
"""
import os
import sys

os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["PYTHONUTF8"] = "1"
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import dotenv

# Patch dotenv to ensure DATABASE_URL is not set in the LiteLLM gateway process
_real_load_dotenv = dotenv.load_dotenv

def _safe_load_dotenv(*args, **kwargs):
    result = _real_load_dotenv(*args, **kwargs)
    os.environ.pop("DATABASE_URL", None)
    return result

dotenv.load_dotenv = _safe_load_dotenv

os.environ.pop("DATABASE_URL", None)
os.environ["STORE_MODEL_IN_DB"] = "False"
# LITELLM_MASTER_KEY must be provided via the environment (e.g. .env or CI secret).
# Do not set a fallback here — an unset key should fail loudly, not use a dev default.

# Suppress banner unicode output on Windows console
try:
    import litellm.proxy.common_utils.banner as banner_mod
    banner_mod.show_banner = lambda *args, **kwargs: None
except Exception:
    pass

from litellm.proxy.proxy_cli import run_server

if __name__ == "__main__":
    sys.argv = [
        "run_server",
        "--config", "infra/litellm/config.yaml",
        "--port", "4000",
        "--host", "127.0.0.1",
    ]
    try:
        run_server()
    except SystemExit as e:
        sys.exit(e.code)

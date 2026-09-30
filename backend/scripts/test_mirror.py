import os, sys, traceback
from dotenv import load_dotenv

print("1. Loading environment...", flush=True)
load_dotenv()
from backend.app.config import Settings
from backend.app.service import RescueService
from backend.app.cloud import mirror_to_qdrant_server

print("2. Initializing service...", flush=True)
s = Settings.from_env()
svc = RescueService(s)
print("3. Calling mirror_to_qdrant_server...", flush=True)
try:
    res = mirror_to_qdrant_server(svc)
    print("4. SUCCESS:", res, flush=True)
except Exception as e:
    print("ERROR in mirror_to_qdrant_server:", e, flush=True)
    traceback.print_exc()
finally:
    svc.close()
    print("5. Done.", flush=True)

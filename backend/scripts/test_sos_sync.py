import os, time
from dotenv import load_dotenv
load_dotenv()
from qdrant_client import QdrantClient
from backend.app.config import Settings
from backend.app.service import RescueService
from backend.app.schemas import ReportRequest, Location

qc = QdrantClient(url=os.getenv('QDRANT_URL'), api_key=os.getenv('QDRANT_API_KEY'))
before = qc.count('rescue_responder_events').count
print(f'Before count: {before}', flush=True)

s = Settings.from_env()
svc = RescueService(s)

print('Creating SOS report...', flush=True)
res = svc.report(ReportRequest(
    kind='sos',
    text=f'LIVE VERIFIED SOS: Survivor trapped under fallen girder near Gate 3 at {time.time()}, heavy blood loss, needs tourniquet and stretcher team',
    reporter_id='survivor-delhi-01',
    severity='red',
    visibility='responders',
    location=Location(lat=28.7045, lon=77.1028)
))
print('Report filed locally:', res['event']['id'], flush=True)

# Wait up to 10 seconds for background auto-mirror thread to complete
print('Waiting for background auto-mirror thread...', flush=True)
for i in range(15):
    time.sleep(1)
    after = qc.count('rescue_responder_events').count
    if after > before:
        print(f'SUCCESS! Qdrant Cloud count increased: {before} -> {after}', flush=True)
        break
else:
    print('Count after wait:', qc.count('rescue_responder_events').count, flush=True)

svc.close()

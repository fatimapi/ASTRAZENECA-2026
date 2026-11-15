"""One heavy job at a time (a CT comparison or an X-ray analysis): on Render's free plan (512 MB) the two
together can exceed memory. A CT job waits for a running X-ray; an X-ray waits a while for a running CT job."""
import asyncio

HEAVY = asyncio.Lock()
XRAY_WAIT_S = 45  # an X-ray request waits this long for a running CT job, then asks to try again

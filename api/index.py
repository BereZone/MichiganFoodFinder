from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta
import asyncio
from contextlib import asynccontextmanager
try:
    from . import scraping
except ImportError:
    import scraping

# In-memory cache
menu_cache = []
last_fetch = None
CACHE_DURATION = timedelta(hours=6) # Increased cache duration as per request
scrape_lock = asyncio.Lock()

async def refresh_cache():
    global menu_cache, last_fetch
    async with scrape_lock:
        print(f"[{datetime.now()}] Starting scheduled menu refresh...")
        try:
            start_date = datetime.today()
            end_date = start_date + timedelta(days=14)
            df = await scraping.build_index_async(start_date, end_date)
            menu_cache = df.to_dict("records")
            last_fetch = datetime.now()
            print(f"[{last_fetch}] Menu refresh complete. {len(menu_cache)} items cached.")
        except Exception as e:
            print(f"Error refreshing menu: {e}")

async def schedule_refresh():
    while True:
        # Refresh every 6 hours
        await asyncio.sleep(6 * 3600)
        await refresh_cache()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initial text, maybe start background task
    print("Starting up UMich Dining API...")
    # Ideally we don't block startup on scrape, but let's kick off a refresh in background
    asyncio.create_task(refresh_cache())
    # Start the periodic refresher
    task = asyncio.create_task(schedule_refresh())
    yield
    # Shutdown
    task.cancel()

app = FastAPI(lifespan=lifespan)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/menus")
async def get_menus(days: int = 14, date: str = None):
    global menu_cache, last_fetch
    
    # If specific date requested, scrape just that date
    if date:
        try:
            target_date = datetime.strptime(date, "%Y-%m-%d")
            df = await scraping.build_index_async(target_date, target_date)
            return df.to_dict("records")
        except Exception as e:
            print(f"Error scraping date {date}: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    # Check cache
    now = datetime.now()
    if menu_cache and last_fetch and (now - last_fetch < CACHE_DURATION):
        return menu_cache

    # If cache miss (shouldn't happen often if background task is running), scrape immediately
    await refresh_cache()
    return menu_cache

@app.get("/api/cron")
async def cron_handler():
    """Endpoint for Vercel Cron or external schedulers"""
    await refresh_cache()
    return {"status": "refreshed", "timestamp": last_fetch}

@app.get("/")
def read_root():
    return {
        "status": "ok", 
        "message": "UMich Dining API is running",
        "cache_status": {
            "last_fetch": last_fetch,
            "items": len(menu_cache)
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

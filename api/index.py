from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta
from . import Food  # Import the existing scraping logic

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory cache
menu_cache = []
last_fetch = None
CACHE_DURATION = timedelta(hours=1)

@app.get("/api/menus")
async def get_menus(days: int = 14, date: str = None):
    global menu_cache, last_fetch
    
    now = datetime.now()
    
    # If specific date requested, scrape just that date (no cache for now, or separate cache)
    if date:
        try:
            target_date = datetime.strptime(date, "%Y-%m-%d")
            # Scrape just this day (start=target, end=target)
            # Note: build_index_async iterates while cur <= end, so passing same date works for 1 day
            df = await Food.build_index_async(target_date, target_date)
            return df.to_dict("records")
        except Exception as e:
            print(f"Error scraping date {date}: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    # Check cache (simple time-based expiration)
    if menu_cache and last_fetch and (now - last_fetch < CACHE_DURATION):
        return menu_cache

    try:
        print(f"Scraping fresh data for {days} days...")
        start_date = datetime.today()
        end_date = start_date + timedelta(days=days)
        
        # Reuse the existing async function from Food.py
        df = await Food.build_index_async(start_date, end_date)
        
        # Convert DataFrame to list of dicts
        menu_cache = df.to_dict("records")
        last_fetch = now
        
        return menu_cache
    except Exception as e:
        print(f"Error scraping data: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
def read_root():
    return {"status": "ok", "message": "UMich Dining API is running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

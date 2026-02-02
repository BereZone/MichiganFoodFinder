import asyncio
import json
import os
from datetime import datetime, timedelta
import sys

# Add the parent directory to sys.path so we can import api.scraping
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from api.scraping import build_index_async
except ImportError:
    # Fallback for when running from root
    from api.scraping import build_index_async

OUTPUT_FILE = "client/public/menus.json"

async def generate_json():
    print("Starting menu scrape...")
    start_date = datetime.today()
    end_date = start_date + timedelta(days=14)
    
    # Scrape data
    items = await build_index_async(start_date, end_date)
    
    # Prepare output structure
    output = {
        "menus": items,
        "last_updated": datetime.now().isoformat(),
        "date_range": {
            "start": start_date.strftime("%Y-%m-%d"),
            "end": end_date.strftime("%Y-%m-%d")
        }
    }
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    
    # Write to file
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
        
    print(f"Successfully wrote {len(items)} items to {OUTPUT_FILE}")

if __name__ == "__main__":
    asyncio.run(generate_json())

import asyncio
import aiohttp
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
import re
import ssl
import certifi

# Define constants
search_item = "Fried Chicken".lower()
start_date = datetime.today()
end_date = start_date + timedelta(days=14)  # Check for the next 14 days

weekday_meals = ["Breakfast", "Lunch", "Dinner"]
weekend_meals = ["Brunch", "Dinner"]

dining_halls = {
    "Bursley": "https://dining.umich.edu/menus-locations/dining-halls/bursley/",
    "East Quad": "https://dining.umich.edu/menus-locations/dining-halls/east-quad/",
    "Markley": "https://dining.umich.edu/menus-locations/dining-halls/markley/",
    "Mosher-Jordan": "https://dining.umich.edu/menus-locations/dining-halls/mosher-jordan/",
    "North Quad": "https://dining.umich.edu/menus-locations/dining-halls/north-quad/",
    "Twigs at Oxford": "https://dining.umich.edu/menus-locations/dining-halls/twigs-at-oxford/",
    "South Quad": "https://dining.umich.edu/menus-locations/dining-halls/south-quad/",
}

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
}

# Create an SSL context using certifi
ssl_context = ssl.create_default_context(cafile=certifi.where())

async def fetch(session, url):
    async with session.get(url, headers=headers, ssl=ssl_context) as response:
        return await response.text()

async def fetch_menu(session, dining_hall_name, base_url, date_str, is_today, meals):
    url = f"{base_url}?date={date_str}" if is_today else f"{base_url}?menuDate={date_str}"
    html_content = await fetch(session, url)
    results = []
    soup = BeautifulSoup(html_content, 'html.parser')
    for meal in meals:
        meal_tabs = soup.find_all('h3')
        found_meal_tab = None
        for tab in meal_tabs:
            a_tag = tab.find('a')
            if a_tag and meal.lower() in a_tag.text.strip().lower():
                found_meal_tab = tab
                break
        if found_meal_tab:
            menu_section = found_meal_tab.find_next('ul')
            if menu_section:
                menu_items = menu_section.find_all('div', class_='item-name')
                for item in menu_items:
                    # Normalize menu item name
                    item_name = re.sub(r'\s+', ' ', item.get_text(strip=True).lower())
                    # Match only exact words using a strict regex
                    if re.fullmatch(rf'{re.escape(search_item)}', item_name):
                        results.append(
                            f"'{search_item.title()}' is available at {dining_hall_name} on {date_str} during {meal}"
                        )
    return results

async def main():
    tasks = []
    current_date = start_date
    async with aiohttp.ClientSession() as session:
        while current_date <= end_date:
            date_str = current_date.strftime('%Y-%m-%d')
            is_today = current_date.date() == start_date.date()
            meals = weekday_meals if current_date.weekday() < 5 else weekend_meals
            for dining_hall_name, base_url in dining_halls.items():
                tasks.append(
                    fetch_menu(session, dining_hall_name, base_url, date_str, is_today, meals)
                )
            current_date += timedelta(days=1)
        results = await asyncio.gather(*tasks)
        for result in results:
            for line in result:
                print(line)

if __name__ == "__main__":
    asyncio.run(main())

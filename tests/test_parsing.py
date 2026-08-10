"""Offline unit tests for the scraper's parsing helpers (no network access)."""

import pathlib
import unittest

from bs4 import BeautifulSoup

from scrape_menus import (
    item_key,
    normalize_cf,
    normalize_nd,
    normalize_spaces,
    parse_menu_html,
    parse_nutrition_from_li,
    parse_tags_from_li_text,
)

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "bursley_2026-07-15.html"


class TestNormalization(unittest.TestCase):
    def test_normalize_spaces(self):
        self.assertEqual(normalize_spaces("  Chicken \n  Shawarma  "), "Chicken Shawarma")
        self.assertEqual(normalize_spaces(None), "")

    def test_item_key_casefolds_and_collapses(self):
        self.assertEqual(item_key("  Chicken   SHAWARMA "), "chicken shawarma")

    def test_normalize_nd(self):
        self.assertEqual(normalize_nd("Low Medium"), "Low/Medium")
        self.assertEqual(normalize_nd("Medium High"), "Medium/High")
        self.assertEqual(normalize_nd("High"), "High")
        self.assertEqual(normalize_nd("garbage"), "")

    def test_normalize_cf(self):
        self.assertEqual(normalize_cf("low"), "Low")
        self.assertEqual(normalize_cf("MEDIUM"), "Medium")
        self.assertEqual(normalize_cf("unknown"), "")


class TestTagParsing(unittest.TestCase):
    def test_full_tag_line(self):
        text = (
            "Grilled Chicken Shawarma Halal Spicy "
            "Nutrient Dense Medium High Carbon Footprint Low "
            "Nutrition Facts Serving Size 4oz"
        )
        nd, cf, others, others_str = parse_tags_from_li_text(text)
        self.assertEqual(nd, "Medium/High")
        self.assertEqual(cf, "Low")
        self.assertEqual(others, ["Halal", "Spicy"])
        self.assertEqual(others_str, "Halal, Spicy")

    def test_vegan_and_vegetarian_are_distinct(self):
        nd, cf, others, _ = parse_tags_from_li_text("Tofu Bowl Vegan Vegetarian Gluten Free")
        self.assertEqual(others, ["Gluten Free", "Vegan", "Vegetarian"])
        self.assertEqual(nd, "")
        self.assertEqual(cf, "")

    def test_no_tags(self):
        nd, cf, others, others_str = parse_tags_from_li_text("Plain Bagel")
        self.assertEqual((nd, cf, others, others_str), ("", "", [], ""))


class TestNutritionParsing(unittest.TestCase):
    LI_HTML = """
    <li>
      <div class="item-name">Grilled Chicken</div>
      <table>
        <tr class="serving-size"><td><strong>Serving Size</strong> 1/2 Cup (113g)</td></tr>
        <tr class="portion-calories"><td>Calories 164</td></tr>
        <tr><td><strong>Total Fat</strong> 3g</td></tr>
        <tr><td><strong>Total Carbohydrate</strong> 20g</td></tr>
        <tr><td><strong>Protein</strong> 12g</td></tr>
        <tr><td><strong>Sodium</strong> 300mg</td></tr>
      </table>
    </li>
    """

    def test_parses_all_fields(self):
        li = BeautifulSoup(self.LI_HTML, "html.parser").find("li")
        nut = parse_nutrition_from_li(li)
        self.assertEqual(nut["calories"], 164)
        self.assertEqual(nut["serving_size"], "1/2 Cup (113g)")
        self.assertEqual(nut["total_fat"], "3g")
        self.assertEqual(nut["total_carbohydrate"], "20g")
        self.assertEqual(nut["protein"], "12g")
        self.assertEqual(nut["sodium"], "300mg")

    def test_serving_size_absent_stays_none(self):
        html = """
        <li><div class="item-name">Mystery</div>
          <table><tr class="portion-calories"><td>Calories 10</td></tr></table>
        </li>
        """
        li = BeautifulSoup(html, "html.parser").find("li")
        self.assertIsNone(parse_nutrition_from_li(li)["serving_size"])

    def test_missing_li_returns_nones(self):
        nut = parse_nutrition_from_li(None)
        self.assertEqual(
            nut,
            {
                "calories": None,
                "serving_size": None,
                "total_fat": None,
                "total_carbohydrate": None,
                "protein": None,
                "sodium": None,
            },
        )


class TestRealPageFixture(unittest.TestCase):
    """Parse a real menu page saved 2026-07-15 (post-redesign markup)."""

    @classmethod
    def setUpClass(cls):
        cls.rows = parse_menu_html(
            FIXTURE.read_text(encoding="utf-8"),
            "Bursley", "2026-07-15", ["Breakfast", "Lunch", "Dinner"],
        )

    def test_parses_a_full_day(self):
        self.assertGreater(len(self.rows), 50)
        self.assertEqual({r["meal"] for r in self.rows}, {"Breakfast", "Lunch", "Dinner"})
        self.assertIn("Hot Cereal", {r["station"] for r in self.rows})

    def test_known_item_details(self):
        oat = next(r for r in self.rows if r["item_display"] == "Oatmeal")
        self.assertEqual(oat["nutrition"]["calories"], 183)
        self.assertEqual(oat["nutrition"]["protein"], "6g")
        self.assertEqual(oat["nutrition"]["serving_size"], "Cups (253g)")
        self.assertEqual(oat["carbon_footprint"], "Low")
        self.assertIn("Vegan", oat["other_tags"])

    def test_nutrition_coverage(self):
        with_cal = sum(1 for r in self.rows if r["nutrition"]["calories"] is not None)
        self.assertGreater(with_cal / len(self.rows), 0.9)

    def test_serving_size_coverage(self):
        sizes = [r["nutrition"]["serving_size"] for r in self.rows]
        present = [s for s in sizes if s]
        self.assertGreater(len(present) / len(sizes), 0.9)
        # Kept verbatim, including the unit text the gram figure sits in.
        self.assertIn("1/2 Cup (113g)", present)


if __name__ == "__main__":
    unittest.main()

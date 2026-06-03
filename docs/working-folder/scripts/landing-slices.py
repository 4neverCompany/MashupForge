import asyncio
from playwright.async_api import async_playwright
import os

async def slice_sections():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page = await ctx.new_page()
        await page.goto("http://localhost:3939", wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(1500)

        sections = [
            ("hero", "#top"),
            ("features", "#features"),
            ("pipeline", "#pipeline"),
            ("stack", "#stack"),
        ]
        for name, sel in sections:
            el = await page.query_selector(sel)
            if el:
                box = await el.bounding_box()
                if box:
                    await page.evaluate(f"window.scrollTo(0, {int(box['y'])-50})")
                    await page.wait_for_timeout(700)
                    await page.screenshot(path=f"/workspace/landing-screens/section-{name}.png", full_page=False)
                    print(f"  section-{name}.png: {int(box['width'])}x{int(box['height'])}")

        # CTA + footer together
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight - 900)")
        await page.wait_for_timeout(700)
        await page.screenshot(path="/workspace/landing-screens/section-cta-footer.png", full_page=False)
        print("  section-cta-footer.png")

        await b.close()

asyncio.run(slice_sections())

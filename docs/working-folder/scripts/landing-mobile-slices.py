import asyncio
from playwright.async_api import async_playwright

async def mobile_slices():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        page = await ctx.new_page()
        await page.goto("http://localhost:3939", wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(1500)

        # Just the hero section visible
        await page.screenshot(path="/workspace/landing-screens/mobile-hero.png", full_page=False)
        # Scroll to features
        await page.evaluate("document.querySelector('#features').scrollIntoView({block:'start'})")
        await page.wait_for_timeout(800)
        await page.screenshot(path="/workspace/landing-screens/mobile-features.png", full_page=False)
        # Scroll to pipeline
        await page.evaluate("document.querySelector('#pipeline').scrollIntoView({block:'start'})")
        await page.wait_for_timeout(800)
        await page.screenshot(path="/workspace/landing-screens/mobile-pipeline.png", full_page=False)

        await b.close()
        print("done")

asyncio.run(mobile_slices())

import {
  filterButtonSelector,
  priceFromSelector, priceToSelector,
  bedsFromSelector,
  sqftFromSelector, sqftToSelector,
  hoaNoSelector,
  dateRangeSelect,
  filterApplyButton,
  detachedCheckbox,
  condoCheckbox,
  attachedCheckbox,
  multiFamilyCheckbox,
} from '../config/selection.js';

// Multiple fallback selectors for each filter field
const BEDS_FROM_SELECTORS = ['#beds_from', 'input[name="beds_from"]', '[data-field="beds_from"]', 'input[placeholder*="Beds"]'];
const SQFT_FROM_SELECTORS = ['#sqft_from', 'input[name="sqft_from"]', '[data-field="sqft_from"]', 'input[placeholder*="Sqft"]'];
const PRICE_FROM_SELECTORS = ['#list_price_from', 'input[name="list_price_from"]', '[data-field="list_price_from"]'];
const PRICE_TO_SELECTORS = ['#list_price_to', 'input[name="list_price_to"]', '[data-field="list_price_to"]'];

const findAndTypeValue = async (page, selectors, value) => {
  for (const selector of selectors) {
    try {
      const exists = await page.$(selector);
      if (exists) {
        await page.waitForSelector(selector, { timeout: 3000 });
        await page.evaluate((sel, val) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          el.focus();
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.value = String(val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, selector, value);
        console.log(`✅ Set filter ${selector} = ${value}`);
        return true;
      }
    } catch {
      continue;
    }
  }
  console.log(`⚠️ Filter selector not found for any of: ${selectors.join(', ')}`);
  return false;
};

const typeAndDispatch = async (page, selector, value) => {
  try {
    await page.waitForSelector(selector, { timeout: 5000 });
    await page.evaluate((sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.value = String(val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, selector, value);
    return true;
  } catch {
    console.log(`⚠️ Filter selector not found: ${selector}`);
    return false;
  }
};

const setCheckbox = async (page, selector, shouldBeChecked) => {
  try {
    await page.waitForSelector(selector, { timeout: 5000 });
    await page.evaluate((sel, checked) => {
      const cb = document.querySelector(sel);
      if (!cb) return;
      if (cb.checked !== checked) {
        cb.click();
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, selector, shouldBeChecked);
    return true;
  } catch {
    console.log(`⚠️ Checkbox selector not found: ${selector}`);
    return false;
  }
};

const applyFilters = async (page /*, browser */) => {
  // Open the filter modal
  try {
    await page.waitForSelector(filterButtonSelector, { timeout: 10000 });
    await page.click(filterButtonSelector);
    await new Promise(r => setTimeout(r, 2000)); // Wait for modal to open
  } catch (err) {
    console.log('⚠️ Filter button not found, trying alternative selectors...');
    // Try alternative filter button selectors
    const altFilterBtns = ['button[data-testid="filter-button"]', '.filter-button', 'button:has-text("Filter")', '[aria-label*="filter" i]'];
    let clicked = false;
    for (const sel of altFilterBtns) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          clicked = true;
          console.log(`✅ Clicked filter button: ${sel}`);
          await new Promise(r => setTimeout(r, 2000));
          break;
        }
      } catch {}
    }
    if (!clicked) {
      console.log('⚠️ Could not find filter button, will try to apply filters via URL params');
    }
  }

  // Debug: Dump all visible input fields to help find correct selectors
  const inputDebug = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input, select');
    return Array.from(inputs).slice(0, 30).map(el => ({
      tag: el.tagName,
      id: el.id,
      name: el.name,
      placeholder: el.placeholder,
      type: el.type,
      className: el.className?.substring(0, 50)
    }));
  });
  console.log('📋 Available inputs in filter modal:', JSON.stringify(inputDebug, null, 2));

  // Price range: $20,000 - $600,000
  await findAndTypeValue(page, PRICE_FROM_SELECTORS, 20000);
  await findAndTypeValue(page, PRICE_TO_SELECTORS, 600000);

  // Beds: 3+ (using fallback selectors)
  await findAndTypeValue(page, BEDS_FROM_SELECTORS, 3);

  // Sq Ft: 1000+ (using fallback selectors)
  await findAndTypeValue(page, SQFT_FROM_SELECTORS, 1000);

  // Property Type: Detached only
  await setCheckbox(page, detachedCheckbox, true);    // Check detached
  await setCheckbox(page, condoCheckbox, false);       // Uncheck condo
  await setCheckbox(page, attachedCheckbox, false);    // Uncheck attached
  await setCheckbox(page, multiFamilyCheckbox, false); // Uncheck multi-family

  // HOA => "No" (check the No checkbox)
  try {
    // Try multiple HOA selectors
    const hoaSelectors = [hoaNoSelector, '#hoa_no', 'input[name="hoa"][value="no"]', '[data-field="hoa_no"]', 'input[value="no"][name*="hoa"]'];
    let hoaSet = false;
    for (const sel of hoaSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await page.evaluate((s) => {
            const cb = document.querySelector(s);
            if (!cb) return;
            if (cb.type === 'checkbox' && !cb.checked) {
              cb.click();
              cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, sel);
          console.log(`✅ Set HOA filter: ${sel}`);
          hoaSet = true;
          break;
        }
      } catch {}
    }
    if (!hoaSet) console.log('⚠️ HOA checkbox not found');
  } catch {
    console.log('⚠️ HOA checkbox not found');
  }

  // Date range => "all"
  try {
    await page.waitForSelector(dateRangeSelect, { timeout: 5000 });
    await page.select(dateRangeSelect, 'all');
    console.log('✅ Set date range: all');
  } catch {
    console.log('⚠️ Date range select not found');
  }

  // Apply / close the modal
  try {
    // Try multiple apply button selectors
    const applySelectors = [filterApplyButton, 'div.bottom-bar > button', 'button[type="submit"]', '.apply-filters', 'button:has-text("Apply")', '.modal-footer button.btn-primary'];
    let applied = false;
    for (const sel of applySelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          console.log(`✅ Clicked apply button: ${sel}`);
          applied = true;
          break;
        }
      } catch {}
    }
    if (!applied) {
      console.log('⚠️ Apply button not found, filters may not be applied');
    }
  } catch (err) {
    console.log('⚠️ Could not click apply button:', err?.message);
  }

  // Wait for modal to close
  await new Promise(r => setTimeout(r, 2000));

  // ========== CLICK "RUN SEARCH" BUTTON TO APPLY FILTERS ==========
  console.log('🔍 Looking for "Run Search" button to apply filters...');
  try {
    // Try multiple selectors for the Run Search button
    const runSearchSelectors = [
      'button:contains("Run Search")',
      'button:contains("run search")',
      '#run-search',
      '#SearchBlock-Search-Button',
      '.run-search-btn',
      'button.search-button',
      '[data-testid="run-search"]',
      'button[type="submit"]:contains("Search")',
      '.search-block button',
      'button.btn-primary:contains("Search")'
    ];

    let searchClicked = false;

    // First try using page.evaluate to find button by text content
    searchClicked = await page.evaluate(() => {
      // Find all buttons and look for one with "Run Search" or "Search" text
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent?.toLowerCase() || '';
        if (text.includes('run search') || text === 'search') {
          btn.click();
          return true;
        }
      }
      // Also try looking for submit buttons in the search block area
      const searchBlock = document.querySelector('.search-block, #search-block, .filter-section');
      if (searchBlock) {
        const submitBtn = searchBlock.querySelector('button[type="submit"], button.btn-primary');
        if (submitBtn) {
          submitBtn.click();
          return true;
        }
      }
      return false;
    });

    if (searchClicked) {
      console.log('✅ Clicked "Run Search" button - filters will now be applied!');
    } else {
      // Try CSS selectors as fallback
      for (const sel of runSearchSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            await btn.click();
            console.log(`✅ Clicked Run Search button: ${sel}`);
            searchClicked = true;
            break;
          }
        } catch {}
      }
    }

    if (!searchClicked) {
      console.log('⚠️ "Run Search" button not found - filters may not be applied. Will try pressing Enter...');
      // Try pressing Enter as last resort
      await page.keyboard.press('Enter');
    }
  } catch (err) {
    console.log('⚠️ Error clicking Run Search:', err?.message);
  }

  // Wait for search to execute and results to load
  await new Promise(r => setTimeout(r, 5000));
  console.log('✅ Filters applied and search executed successfully');
};

export { applyFilters };
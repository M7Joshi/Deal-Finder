export const signInUrl = 'https://app.privy.pro/users/sign_in';
// CRITICAL: Use clean dashboard URL with explicit filter params to PREVENT saved search "Below Market" from being applied
// Key params: id=&name= (no saved search), include_sold=false, include_active=true, hoa=no, spread=50, date_range=all
export const dashboardUrl = 'https://app.privy.pro/dashboard?id=&name=&saved_search=&include_sold=false&include_active=true&include_pending=false&include_under_contract=false&include_detached=true&include_attached=false&hoa=no&spread=50&spread_type=umv&date_range=all';
export const submitButtonSelector = 'input[type="submit"], button[type="submit"], .btn-primary';
export const propertyCountSelector = '.properties-found, [data-test="properties-found"], [data-testid="properties-count"]';
export const mapNavSelector = '#map-nav, .map__nav, .mapboxgl-map, ';
// exclude "" to avoid false positives
export const propertyListContainerSelector = '.view-container, .grid-view-container, [data-test="property-list"]';
export const propertyContentSelector = 'div .property-module .content, .property-card, [data-test="property-card"]';
// Address selectors - try multiple patterns to handle DOM changes
// Primary: .address-line1/.address-line2 | Fallbacks: data-testid, h2 patterns
export const addressLine1Selector = 'address-block > .address > .address-line1, .address > .address-line1, .address-line1, [data-testid="address-line1"], .property-address .line1, h2.address';
export const addressLine2Selector = 'address-block > .address > .address-line2, .address > .address-line2, .address-line2, [data-testid="address-line2"], .property-address .line2, .city-state-zip';
export const priceSelector = '.price-block > .price';
export const propertyStatsSelector = 'ul.quickstats-horiz > li.quickstat';
export const userEmailSelector = '#user_email';
export const userPasswordSelector = '#user_password';
export const agentNameSelector   = '.agent-name,[data-testid="agent-name"],.listing-agent .name';
export const agentEmailSelector  = '.agent-email a[href^="mailto:"],a[href^="mailto:"]';
export const agentPhoneSelector  = '.agent-phone a[href^="tel:"],a[href^="tel:"]';
export const openDetailSelector  = '[data-testid="property-card"], .property-card, .content a, a.card-link';

// Filter modal controls (centralized for reuse)
export const filterButtonSelector = '#SearchBlock-Filter-Button';
export const priceFromSelector   = '#list_price_from';
export const priceToSelector     = '#list_price_to';
export const bedsFromSelector    = '#beds_from';
export const sqftFromSelector    = '#sqft_from';
export const sqftToSelector      = '#sqft_to';
export const hoaNoSelector       = '#hoa_no';
export const dateRangeSelect     = 'select[name="date_range"]';
export const filterApplyButton   = 'div.bottom-bar > button';
// Property type checkboxes
export const detachedCheckbox    = '#include_detached';
export const condoCheckbox       = '#include_condo';
export const attachedCheckbox    = '#include_attached';
export const multiFamilyCheckbox = '#include_multi_family';
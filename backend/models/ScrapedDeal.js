import mongoose from 'mongoose';

const ScrapedDealSchema = new mongoose.Schema({
  // Address fields
  address: { type: String, required: true },
  fullAddress: { type: String, required: true },
  fullAddress_ci: { type: String, required: true }, // lowercase for deduplication
  city: { type: String, default: null },
  state: { type: String, default: null },
  zip: { type: String, default: null },

  // Pricing
  listingPrice: { type: Number, default: null }, // L.P from Privy or Redfin
  amv: { type: Number, default: null },          // BofA AMV

  // Source tracking
  source: { type: String, enum: ['privy', 'redfin'], required: true },

  // Optional property details
  beds: { type: Number, default: null },
  baths: { type: Number, default: null },
  sqft: { type: Number, default: null },

  // Agent details (from Privy or Redfin)
  agentName: { type: String, default: null },
  agentPhone: { type: String, default: null },
  agentEmail: { type: String, default: null },
  brokerage: { type: String, default: null },

  // Agent lookup status for Privy deals
  // 'pending' = not looked up yet, 'found' = agent found, 'not_found' = looked up but no agent in Privy
  agentLookupStatus: { type: String, enum: ['pending', 'found', 'not_found', null], default: null },
  agentLookupAt: { type: Date, default: null }, // When agent lookup was performed

  // Auto-email tracking
  agentEmailSent: { type: Boolean, default: false },
  emailSentAt: { type: Date, default: null },
  emailMessageId: { type: String, default: null },

  // Timestamps
  scrapedAt: { type: Date, default: Date.now },      // When address was fetched from source
  bofaFetchedAt: { type: Date, default: null },      // When BofA AMV was fetched

  // Deal flag - TRUE if AMV >= 2x listingPrice
  isDeal: { type: Boolean, default: false },

  // Multi-user support
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

// Index for fast lookups and deduplication
ScrapedDealSchema.index({ fullAddress_ci: 1 }, { unique: true });
ScrapedDealSchema.index({ source: 1 });
ScrapedDealSchema.index({ state: 1 });
ScrapedDealSchema.index({ createdAt: -1 });
ScrapedDealSchema.index({ isDeal: 1 }); // For filtering deals

// Helper function to calculate if it's a deal
// Requirements: AMV >= 2x LP AND AMV > $200,000
const MIN_AMV_FOR_DEAL = 200000;

function calculateIsDeal(amv, listingPrice) {
  if (!amv || !listingPrice || amv <= 0 || listingPrice <= 0) {
    return false;
  }
  // Deal criteria: AMV >= 2x listing price AND AMV > $200,000
  return amv >= (listingPrice * 2) && amv > MIN_AMV_FOR_DEAL;
}

// Pre-save hook to normalize fullAddress_ci
ScrapedDealSchema.pre('validate', function(next) {
  if (this.fullAddress) {
    this.fullAddress = String(this.fullAddress).trim();
    this.fullAddress_ci = this.fullAddress.toLowerCase();
  }
  if (this.state && typeof this.state === 'string') {
    this.state = this.state.trim().toUpperCase();
  }
  next();
});

ScrapedDealSchema.pre('save', function(next) {
  if (this.fullAddress && !this.fullAddress_ci) {
    this.fullAddress_ci = this.fullAddress.trim().toLowerCase();
  }
  if (this.state && typeof this.state === 'string') {
    this.state = this.state.trim().toUpperCase();
  }
  // Auto-calculate isDeal based on AMV >= 2x LP
  this.isDeal = calculateIsDeal(this.amv, this.listingPrice);
  next();
});

const ScrapedDeal = mongoose.model('ScrapedDeal', ScrapedDealSchema);
export default ScrapedDeal;

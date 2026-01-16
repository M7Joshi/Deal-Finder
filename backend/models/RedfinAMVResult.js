import mongoose from 'mongoose';

const redfinAMVResultSchema = new mongoose.Schema({
  propertyId: { type: String, required: true, index: true },
  address: { type: String, required: true },
  city: { type: String, default: null },
  state: { type: String, default: null },
  listPrice: { type: Number, default: null },
  beds: { type: Number, default: null },
  baths: { type: Number, default: null },
  sqft: { type: Number, default: null },
  amv: { type: Number, default: null },
  success: { type: Boolean, default: false },
  error: { type: String, default: null },
  timeMs: { type: Number, default: 0 },
  isDeal: { type: Boolean, default: false },
  url: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

// Index for quick lookups
redfinAMVResultSchema.index({ state: 1, city: 1 });
redfinAMVResultSchema.index({ createdAt: -1 });
redfinAMVResultSchema.index({ isDeal: 1 });

// Compound index for duplicate check
redfinAMVResultSchema.index({ propertyId: 1, state: 1 }, { unique: true });

const RedfinAMVResult = mongoose.model('RedfinAMVResult', redfinAMVResultSchema);
export default RedfinAMVResult;

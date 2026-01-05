const mongoose = require("mongoose");
require("dotenv").config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const ScrapedDeal = mongoose.model("ScrapedDeal", new mongoose.Schema({}, { strict: false }), "scrapeddeals");

  const now = new Date();
  const min5 = new Date(now - 5*60*1000);
  const min30 = new Date(now - 30*60*1000);
  const hour1 = new Date(now - 60*60*1000);

  const last5min = await ScrapedDeal.countDocuments({ bofaFetchedAt: { $gte: min5 } });
  const last30min = await ScrapedDeal.countDocuments({ bofaFetchedAt: { $gte: min30 } });
  const last1hour = await ScrapedDeal.countDocuments({ bofaFetchedAt: { $gte: hour1 } });

  console.log("=== BOFA PROCESSING SPEED ===");
  console.log("Last 5 min:", last5min);
  console.log("Last 30 min:", last30min);
  console.log("Last 1 hour:", last1hour);
  console.log("Rate: ~" + Math.round(last30min / 30) + " per minute");

  const recent = await ScrapedDeal.find({ bofaFetchedAt: { $gte: hour1 } })
    .sort({ bofaFetchedAt: -1 }).limit(10).select("fullAddress amv bofaFetchedAt").lean();

  console.log("\n=== RECENT AMV LOOKUPS ===");
  if (recent.length === 0) console.log("NO AMV lookups in last hour\!");
  recent.forEach(r => {
    const ago = Math.round((now - new Date(r.bofaFetchedAt)) / 60000);
    console.log(ago + " min ago | AMV: " + r.amv + " | " + (r.fullAddress || "").slice(0, 40));
  });

  const pending = await ScrapedDeal.countDocuments({
    $or: [{ amv: null }, { amv: { $exists: false } }, { amv: 0 }]
  });
  console.log("\n=== PENDING ===\nTotal:", pending);

  const lastEver = await ScrapedDeal.findOne({ bofaFetchedAt: { $exists: true } })
    .sort({ bofaFetchedAt: -1 }).select("bofaFetchedAt fullAddress").lean();
  if (lastEver) {
    const lastAgo = Math.round((now - new Date(lastEver.bofaFetchedAt)) / 60000);
    console.log("\nLast BofA activity:", lastAgo, "minutes ago");
    if (lastAgo > 10) console.log("⚠️ WARNING: BofA might be stuck\!");
  }

  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });

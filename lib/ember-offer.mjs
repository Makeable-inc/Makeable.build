// Shared presentation and checkout defaults.
const markets = { US: { currency: "usd", unitAmount: "3499" }, SG: { currency: "sgd", unitAmount: "4499" } };
const defaultMarket = "US";
const shippingName = "Free shipping";
export const EMBER_OFFER = Object.freeze({
  version: "ember_usd_3499_free_shipping_end_nov_2026_v2",
  name: "Makeable Ember", color: "bone", market: defaultMarket, quantity: 1,
  colors: { sage: "Sage", bone: "Beige", blush: "Sakura" },
  markets,
  priceLabel: `USD ${new Intl.NumberFormat("en-US", {style: "currency", currency: markets[defaultMarket].currency}).format(Number(markets[defaultMarket].unitAmount) / 100)}`,
  shippingAmount: "0", shippingName, shippingLabel: `${shippingName}.`,
  shippingMessage: "Pre-orders are expected to ship by end November 2026.",
  description: "Token-burner desk pet. Easy-to-assemble kit, USB-C cable included.",
});

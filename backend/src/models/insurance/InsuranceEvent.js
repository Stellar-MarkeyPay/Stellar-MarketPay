// src/models/insurance/InsuranceEvent.js
"use strict";

// Enum representing insured event types
const InsuranceEvent = Object.freeze({
  NON_DELIVERY: "non_delivery",
  LATE_DELIVERY: "late_delivery",
  QUALITY_DISPUTE: "quality_dispute",
  COUNTERPARTY_DEFAULT: "counterparty_default",
});

module.exports = InsuranceEvent;

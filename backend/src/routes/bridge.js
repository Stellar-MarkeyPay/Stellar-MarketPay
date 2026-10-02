"use strict";

const express = require("express");
const router = express.Router();
const bridgeRelayService = require("../services/bridgeRelayService");
const { verifyJWT } = require("../middleware/auth");

router.get("/status", (req, res) => {
  res.json(bridgeRelayService.getStatus());
});

router.post("/recover/:transferId", verifyJWT, async (req, res) => {
  try {
    const result = await bridgeRelayService.emergencyRecover(req.params.transferId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/retry/:transferId", verifyJWT, async (req, res) => {
  try {
    const result = await bridgeRelayService.retryFailedTransfer(req.params.transferId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/pause", verifyJWT, (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  bridgeRelayService.triggerCircuitBreaker("manual");
  res.json({ message: "Bridge paused" });
});

router.post("/resume", verifyJWT, (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  bridgeRelayService.resumeBridge();
  res.json({ message: "Bridge resumed" });
});

module.exports = router;

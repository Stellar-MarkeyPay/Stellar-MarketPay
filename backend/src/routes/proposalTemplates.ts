"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} = require("../services/proposalTemplateService");

router.get("/", verifyJWT, async (req: any, res: any, next: any) => {
  try {
    const templates = await listTemplates(req.user.publicKey);
    res.json({ success: true, data: templates });
  } catch (e) {
    next(e);
  }
});

router.post("/", verifyJWT, async (req: any, res: any, next: any) => {
  try {
    const template = await createTemplate({
      freelancerAddress: req.user.publicKey,
      name: req.body.name,
      content: req.body.content,
    });
    res.status(201).json({ success: true, data: template });
  } catch (e) {
    next(e);
  }
});

router.patch("/:id", verifyJWT, async (req: any, res: any, next: any) => {
  try {
    const template = await updateTemplate({
      id: req.params.id,
      freelancerAddress: req.user.publicKey,
      name: req.body.name,
      content: req.body.content,
    });
    res.json({ success: true, data: template });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", verifyJWT, async (req: any, res: any, next: any) => {
  try {
    await deleteTemplate(req.params.id, req.user.publicKey);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

export {};

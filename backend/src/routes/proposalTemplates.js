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

/**
 * @swagger
 * /api/proposal-templates:
 *   get:
 *     summary: List the authenticated freelancer's proposal templates
 *     description: >
 *       Returns all reusable proposal templates owned by the authenticated
 *       user, ordered by most recently updated first.
 *     tags: [ProposalTemplates]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Templates retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       freelancerAddress:
 *                         type: string
 *                       name:
 *                         type: string
 *                       content:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *             example:
 *               success: true
 *               data:
 *                 - id: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *                   freelancerAddress: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *                   name: Standard rate proposal
 *                   content: "Hi, I'd love to work on this project. My rate is..."
 *                   createdAt: "2026-07-01T09:00:00.000Z"
 *                   updatedAt: "2026-08-15T11:20:00.000Z"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get("/", verifyJWT, async (req, res, next) => {
  try {
    const templates = await listTemplates(req.user.publicKey);
    res.json({ success: true, data: templates });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/proposal-templates:
 *   post:
 *     summary: Create a proposal template
 *     description: >
 *       Creates a new reusable proposal template owned by the authenticated
 *       user. Both `name` and `content` are required and must be
 *       non-empty after trimming. Each freelancer may have at most 10
 *       templates; exceeding that limit returns 400.
 *     tags: [ProposalTemplates]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - content
 *             properties:
 *               name:
 *                 type: string
 *                 description: Template name
 *                 example: Standard rate proposal
 *               content:
 *                 type: string
 *                 description: Template body text
 *                 example: "Hi, I'd love to work on this project. My rate is..."
 *           example:
 *             name: Standard rate proposal
 *             content: "Hi, I'd love to work on this project. My rate is..."
 *     responses:
 *       201:
 *         description: Template created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     freelancerAddress:
 *                       type: string
 *                     name:
 *                       type: string
 *                     content:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *             example:
 *               success: true
 *               data:
 *                 id: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *                 freelancerAddress: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *                 name: Standard rate proposal
 *                 content: "Hi, I'd love to work on this project. My rate is..."
 *                 createdAt: "2026-08-21T09:00:00.000Z"
 *                 updatedAt: "2026-08-21T09:00:00.000Z"
 *       400:
 *         description: Missing name/content, or the freelancer already has 10 templates
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               missingFields:
 *                 summary: name or content missing/empty
 *                 value:
 *                   error: Template name and content are required
 *               limitReached:
 *                 summary: Freelancer already has the maximum number of templates
 *                 value:
 *                   error: Maximum 10 templates allowed per freelancer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post("/", verifyJWT, async (req, res, next) => {
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

/**
 * @swagger
 * /api/proposal-templates/{id}:
 *   patch:
 *     summary: Update a proposal template
 *     description: >
 *       Updates the `name` and/or `content` of a template owned by the
 *       authenticated user. At least one of `name` or `content` must be
 *       provided. Only templates owned by the authenticated user
 *       (matched by `freelancerAddress`) can be updated; a template
 *       belonging to another user, or a nonexistent ID, returns 404.
 *     tags: [ProposalTemplates]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Template ID
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: New template name
 *                 example: Discounted rate proposal
 *               content:
 *                 type: string
 *                 description: New template body text
 *                 example: "Hi, given the scope of this project, I'd offer a discounted rate of..."
 *           example:
 *             name: Discounted rate proposal
 *             content: "Hi, given the scope of this project, I'd offer a discounted rate of..."
 *     responses:
 *       200:
 *         description: Template updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     freelancerAddress:
 *                       type: string
 *                     name:
 *                       type: string
 *                     content:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *             example:
 *               success: true
 *               data:
 *                 id: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *                 freelancerAddress: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *                 name: Discounted rate proposal
 *                 content: "Hi, given the scope of this project, I'd offer a discounted rate of..."
 *                 createdAt: "2026-07-01T09:00:00.000Z"
 *                 updatedAt: "2026-08-21T09:05:00.000Z"
 *       400:
 *         description: Neither name nor content was provided
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: At least one field is required to update template
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Template not found, or not owned by the authenticated user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Template not found
 */
router.patch("/:id", verifyJWT, async (req, res, next) => {
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

/**
 * @swagger
 * /api/proposal-templates/{id}:
 *   delete:
 *     summary: Delete a proposal template
 *     description: >
 *       Deletes a template owned by the authenticated user. A template
 *       belonging to another user, or a nonexistent ID, returns 404.
 *     tags: [ProposalTemplates]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Template ID
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     responses:
 *       200:
 *         description: Template deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Template not found, or not owned by the authenticated user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Template not found
 */
router.delete("/:id", verifyJWT, async (req, res, next) => {
  try {
    await deleteTemplate(req.params.id, req.user.publicKey);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

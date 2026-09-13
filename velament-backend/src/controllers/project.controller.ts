import { enqueueAnalysis } from "../services/job.service.js";
import {
  repositoryToken,
  githubRequest,
} from "../services/github-app.service.js";
import { z } from "zod";
import { HttpError } from "../utils/errors.js";
import type { RequestHandler } from "express";
import { projectInput, objectId } from "@velament/shared";
import { Project } from "../models/Project.js";
import { Revision } from "../models/Revision.js";
import { ownProject } from "../services/project.service.js";
export const listProjects: RequestHandler = async (req, res) => {
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(1)
    .parse(req.query.page);
  const status = z
    .enum(["active", "archived"])
    .default("active")
    .parse(req.query.status);
  res.json({
    data: await Project.find({
      userId: res.locals.userId,
      archivedAt: status === "archived" ? { $type: "date" } : null,
    })
      .sort({ _id: -1 })
      .skip((page - 1) * 25)
      .limit(25),
    page,
  });
};
export const createProject: RequestHandler = async (req, res) => {
  const input = projectInput.parse(req.body);
  const token = await repositoryToken(
    res.locals.userId,
    input.installationId,
    input.repositoryId,
  );
  const repo = z
    .object({ id: z.number() })
    .parse(
      await githubRequest(
        "/repos/" +
          encodeURIComponent(input.owner) +
          "/" +
          encodeURIComponent(input.repo),
        token,
      ),
    );
  if (repo.id !== input.repositoryId)
    throw new HttpError(
      422,
      "REPOSITORY_MISMATCH",
      "Repository identity does not match",
    );
  res.status(201).json({
    data: await Project.create({
      ...input,
      owner: input.owner.toLowerCase(),
      repo: input.repo.toLowerCase(),
      userId: res.locals.userId,
    }),
  });
};
export const projectAccess: RequestHandler = async (req, res, next) => {
  const id = objectId.parse(req.params.projectId);
  await ownProject(res.locals.userId, id);
  res.locals.projectId = id;
  next();
};
export const analyzeProject: RequestHandler = async (req, res) => {
  const key = z.string().min(8).max(100).parse(req.get("Idempotency-Key"));
  res
    .status(202)
    .json({ data: await enqueueAnalysis(res.locals.projectId, key) });
};
export const listRevisions: RequestHandler = async (req, res) => {
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(1)
    .parse(req.query.page);
  res.json({
    data: await Revision.find({ projectId: res.locals.projectId })
      .select("-files.content -edges")
      .sort({ createdAt: -1 })
      .skip((page - 1) * 25)
      .limit(25),
    page,
  });
};

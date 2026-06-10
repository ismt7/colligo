import { Router } from "express";
import { listFeeds, getFeed, createFeed, patchFeed, deleteFeed } from "../controllers/feeds";
import { listArticles } from "../controllers/articles";

const router = Router();

router.get("/", listFeeds);
router.post("/", createFeed);
router.get("/:id", getFeed);
router.patch("/:id", patchFeed);
router.delete("/:id", deleteFeed);

// Nested: GET /feeds/:feedId/articles
router.get("/:feedId/articles", listArticles);

export default router;

import { Router } from "express";
import { listArticles, getArticle } from "../controllers/articles";

const router = Router();

router.get("/", listArticles);
router.get("/:id", getArticle);

export default router;

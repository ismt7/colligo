import swaggerJSDoc from "swagger-jsdoc";

const openApiDefinition = {
  openapi: "3.0.3",
  info: {
    title: "colligo API",
    version: "0.1.0",
    description: "RSS feed aggregator API",
  },
  servers: [{ url: "/" }],
  tags: [{ name: "Health" }, { name: "Feeds" }, { name: "Articles" }],
  components: {
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          error: { type: "string", example: "Feed not found" },
        },
        required: ["error"],
      },
      Feed: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          url: { type: "string", example: "https://techcrunch.com/feed/" },
          name: { type: "string", example: "Tech Crunch" },
          active: { type: "boolean", example: true },
          lastFetchedAt: { type: "string", format: "date-time", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "url", "name", "active", "createdAt", "updatedAt"],
      },
      FeedCreateRequest: {
        type: "object",
        properties: {
          url: { type: "string", example: "https://techcrunch.com/feed/" },
          name: { type: "string", example: "Tech Crunch" },
          active: { type: "boolean", example: true },
        },
        required: ["url", "name"],
      },
      FeedPatchRequest: {
        type: "object",
        properties: {
          url: { type: "string", example: "https://techcrunch.com/feed/" },
          name: { type: "string", example: "Tech Crunch" },
          active: { type: "boolean", example: true },
        },
      },
      ArticleFeed: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          name: { type: "string", example: "Tech Crunch" },
          url: { type: "string", example: "https://techcrunch.com/feed/" },
        },
        required: ["id", "name", "url"],
      },
      Article: {
        type: "object",
        properties: {
          id: { type: "integer", example: 10 },
          feedId: { type: "integer", example: 1 },
          title: { type: "string", example: "Example article" },
          url: { type: "string", example: "https://example.com/article" },
          guid: { type: "string", nullable: true },
          content: { type: "string", nullable: true },
          publishedAt: { type: "string", format: "date-time", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          feed: { $ref: "#/components/schemas/ArticleFeed" },
        },
        required: [
          "id",
          "feedId",
          "title",
          "url",
          "createdAt",
          "updatedAt",
          "feed",
        ],
      },
      PaginatedArticles: {
        type: "object",
        properties: {
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/Article" },
          },
          meta: {
            type: "object",
            properties: {
              total: { type: "integer", example: 123 },
              page: { type: "integer", example: 1 },
              limit: { type: "integer", example: 20 },
              totalPages: { type: "integer", example: 7 },
            },
            required: ["total", "page", "limit", "totalPages"],
          },
        },
        required: ["data", "meta"],
      },
      HealthResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "ok" },
        },
        required: ["status"],
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        responses: {
          "200": {
            description: "Service is healthy",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
          },
        },
      },
    },
    "/feeds": {
      get: {
        tags: ["Feeds"],
        summary: "List feeds",
        responses: {
          "200": {
            description: "Feed list",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Feed" },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Feeds"],
        summary: "Create feed",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FeedCreateRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Feed created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Feed" },
              },
            },
          },
          "400": {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/feeds/{id}": {
      get: {
        tags: ["Feeds"],
        summary: "Get feed by id",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: {
          "200": {
            description: "Feed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Feed" },
              },
            },
          },
          "404": {
            description: "Feed not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
      patch: {
        tags: ["Feeds"],
        summary: "Update feed",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FeedPatchRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Feed updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Feed" },
              },
            },
          },
          "400": {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "404": {
            description: "Feed not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
      delete: {
        tags: ["Feeds"],
        summary: "Delete feed",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: {
          "204": { description: "Feed deleted" },
          "404": {
            description: "Feed not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/articles": {
      get: {
        tags: ["Articles"],
        summary: "List articles",
        parameters: [
          {
            name: "feedId",
            in: "query",
            required: false,
            schema: { type: "integer" },
          },
          {
            name: "page",
            in: "query",
            required: false,
            schema: { type: "integer", default: 1 },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", default: 20, maximum: 100 },
          },
          {
            name: "since",
            in: "query",
            required: false,
            schema: { type: "string", format: "date-time" },
          },
        ],
        responses: {
          "200": {
            description: "Paginated articles",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PaginatedArticles" },
              },
            },
          },
          "400": {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "404": {
            description: "Feed not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/feeds/{feedId}/articles": {
      get: {
        tags: ["Articles"],
        summary: "List articles by feed",
        parameters: [
          {
            name: "feedId",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
          {
            name: "page",
            in: "query",
            required: false,
            schema: { type: "integer", default: 1 },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", default: 20, maximum: 100 },
          },
          {
            name: "since",
            in: "query",
            required: false,
            schema: { type: "string", format: "date-time" },
          },
        ],
        responses: {
          "200": {
            description: "Paginated articles",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PaginatedArticles" },
              },
            },
          },
          "400": {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "404": {
            description: "Feed not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/articles/{id}": {
      get: {
        tags: ["Articles"],
        summary: "Get article by id",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: {
          "200": {
            description: "Article",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Article" },
              },
            },
          },
          "400": {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "404": {
            description: "Article not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
  },
} as const;

const openApiSpec = swaggerJSDoc({
  definition: openApiDefinition,
  apis: [],
});

export default openApiSpec;

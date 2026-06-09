// One-off catalog setup: create starter products in the EMMA GLAM Shopify store
// via the OpenInt Admin proxy. Run from the Repl shell: `node seed-shopify.mjs`.
// Shopify is the system of record; after running, call POST /api/shopify/sync.

const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
const token = process.env.REPL_IDENTITY
  ? `repl ${process.env.REPL_IDENTITY}`
  : process.env.WEB_REPL_RENEWAL
    ? `depl ${process.env.WEB_REPL_RENEWAL}`
    : null;

if (!hostname || !token) {
  console.error("Missing Replit connector environment. Run inside the Repl shell.");
  process.exit(1);
}

const protocol = hostname.startsWith("localhost") ? "http" : "https";
const ADMIN_PATH = "/admin/api/2026-04/graphql.json";

async function admin(query, variables) {
  const resp = await fetch(`${protocol}://${hostname}/api/v2/proxy${ADMIN_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Replit-Token": token,
      "Connector-Name": "shopify-store",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await resp.json();
  if (json.errors?.length) throw new Error("GraphQL errors: " + JSON.stringify(json.errors));
  return json.data;
}

function assertNoUserErrors(node, label) {
  if (node?.userErrors?.length) {
    throw new Error(`${label} userErrors: ${JSON.stringify(node.userErrors)}`);
  }
}

const VENDOR = "EMMA GLAM";

const PRODUCTS = [
  {
    title: "Black Obsidian Gown",
    productType: "Evening Dresses",
    price: "599.00",
    compareAt: "899.00",
    qty: 25,
    tags: ["featured", "evening"],
    image: "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=1000",
    descriptionHtml:
      "<p>فستان سهرة أسود فاخر بقصّة انسيابية تبرز رشاقة القوام. خامة راقية وملمس ناعم لإطلالة ملكية لا تُنسى.</p>",
  },
  {
    title: "Scarlet Velvet Column",
    productType: "Evening Dresses",
    price: "549.00",
    compareAt: "799.00",
    qty: 20,
    tags: ["featured", "evening"],
    image: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1000",
    descriptionHtml:
      "<p>فستان مخمل أحمر قرمزي بتصميم عمودي أنيق يمنحك حضوراً جريئاً وفخماً في المناسبات الخاصة.</p>",
  },
  {
    title: "Rose Satin Wrap Dress",
    productType: "Cocktail Dresses",
    price: "429.00",
    compareAt: "599.00",
    qty: 30,
    tags: ["cocktail"],
    image: "https://images.unsplash.com/photo-1585487000160-6ebcfceb0d03?w=1000",
    descriptionHtml:
      "<p>فستان كوكتيل من الساتان الوردي بقصّة لفّ ناعمة تحتضن القوام بأناقة. مثالي للسهرات والمناسبات.</p>",
  },
];

async function resolveLocation() {
  const data = await admin(`query { locations(first: 10) { nodes { id name isActive } } }`);
  const nodes = data.locations.nodes.filter((n) => n.isActive);
  const preferred = nodes.find((n) => /emma/i.test(n.name)) || nodes[0];
  if (!preferred) throw new Error("No active location found");
  return preferred.id;
}

async function resolvePublications() {
  const data = await admin(`query { publications(first: 20) { nodes { id name } } }`);
  const wanted = ["Replit", "Online Store"];
  return data.publications.nodes.filter((n) => wanted.includes(n.name)).map((n) => n.id);
}

async function imageOk(url) {
  try {
    const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function createProduct(p, locationId, publicationIds) {
  // 1. create product (ACTIVE) and read its default variant + inventory item
  const created = await admin(
    `mutation ProductCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id title handle
          variants(first: 1) { nodes { id inventoryItem { id } } }
        }
        userErrors { field message }
      }
    }`,
    {
      product: {
        title: p.title,
        descriptionHtml: p.descriptionHtml,
        productType: p.productType,
        vendor: VENDOR,
        tags: p.tags,
        status: "ACTIVE",
      },
    },
  );
  assertNoUserErrors(created.productCreate, "productCreate");
  const product = created.productCreate.product;
  const variant = product.variants.nodes[0];

  // 2. set price/compare-at and disable inventory tracking.
  // This is a supplier-fulfilled (dropshipping) store, so Shopify does not hold
  // stock: untracked + CONTINUE keeps items always available for purchase.
  const priced = await admin(
    `mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price }
        userErrors { field message }
      }
    }`,
    {
      productId: product.id,
      variants: [
        {
          id: variant.id,
          price: p.price,
          compareAtPrice: p.compareAt,
          inventoryPolicy: "CONTINUE",
          inventoryItem: { tracked: false },
        },
      ],
    },
  );
  assertNoUserErrors(priced.productVariantsBulkUpdate, "productVariantsBulkUpdate");

  // 3. attach image (best-effort)
  if (p.image && (await imageOk(p.image))) {
    const media = await admin(
      `mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media { alt status }
          mediaUserErrors { field message }
        }
      }`,
      {
        productId: product.id,
        media: [{ originalSource: p.image, alt: p.title, mediaContentType: "IMAGE" }],
      },
    );
    if (media.productCreateMedia?.mediaUserErrors?.length) {
      console.warn(`  image warning for ${p.title}:`, JSON.stringify(media.productCreateMedia.mediaUserErrors));
    }
  } else {
    console.warn(`  skipping image for ${p.title} (url not reachable)`);
  }

  // 4. publish to storefront publications
  if (publicationIds.length > 0) {
    const published = await admin(
      `mutation Publish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) { userErrors { field message } }
      }`,
      { id: product.id, input: publicationIds.map((publicationId) => ({ publicationId })) },
    );
    assertNoUserErrors(published.publishablePublish, "publishablePublish");
  }

  return product;
}

async function main() {
  const locationId = await resolveLocation();
  const publicationIds = await resolvePublications();
  console.log("location:", locationId);
  console.log("publications:", publicationIds);

  for (const p of PRODUCTS) {
    const product = await createProduct(p, locationId, publicationIds);
    console.log(`created: ${product.title} (${product.id})`);
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

const express = require("express");
const app = express();
const { resolve } = require("path");
// Replace if using a different env file or config
const env = require("dotenv").config({ path: "./.env" });

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2020-08-27",
  appInfo: {
    // For sample support and debugging, not required for production:
    name: "stripe-samples/identity/modal",
    version: "0.0.1",
    url: "https://github.com/stripe-samples",
  },
});

const flag = false;

app.use(express.static(process.env.STATIC_DIR));
app.use(
  express.json({
    // We need the raw body to verify webhook signatures.
    // Let's compute it only when hitting the Stripe webhook endpoint.
    verify: function (req, res, buf) {
      if (req.originalUrl.startsWith("/webhook")) {
        req.rawBody = buf.toString();
      }
    },
  })
);

app.get("/", (req, res) => {
  const path = resolve(process.env.STATIC_DIR + "/index.html");
  res.sendFile(path);
});

app.get("/config", (req, res) => {
  res.send({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
});

app.get("/status", (req, res) => {
  res.send({
    flag: flag,
  });
});

app.get("/verification_reports/:id", async (req, res) => {
  const verificationReport = await stripe.identity.verificationReports.retrieve(
    req.params.verificationReportId
  );
  console.log(
    `.....................VERIFIED REPORT............... ${JSON.stringify(
      verificationReport
    )}`
  );
  res.send({
    verificationReport: verificationReport,
  });
});

app.get("/verification_session/:id", async (req, res) => {
  const verifiedSession = await stripe.identity.verificationSession.retrieve(
    req.params.id
  );
  console.log(
    `.....................VERIFIED SESSION............... ${JSON.stringify(
      verificationReport
    )}`
  );
  res.send({
    verifiedSession: verifiedSession,
  });
});

app.post("/create-verification-session", async (req, res) => {
  try {
    const verificationSession =
      await stripe.identity.verificationSessions.create({
        type: "document",
        metadata: {
          user_id: Math.floor(Math.random()),
        },

        options: {
          document: {
            allowed_types: ["driving_license"],
            require_matching_selfie: true,
            require_live_capture: true,
          },
          // idempotencyKey: "nE7oBLux7IBuotRN",
        },
      });

    // Send publishable key and PaymentIntent details to client
    res.send({
      data: {
        client_secret: verificationSession.client_secret,
        verificationSessionId: verificationSession.id,
      },
    });
  } catch (e) {
    console.log(e);
    return res.status(400).send({
      error: {
        message: e.message,
      },
    });
  }
});

// Expose a endpoint as a webhook handler for asynchronous events.
// Configure your webhook in the stripe developer dashboard
// https://dashboard.stripe.com/test/webhooks
app.post("/webhook", async (req, res) => {
  let data, eventType;

  // Check if webhook signing is configured.
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    // Retrieve the event by verifying the signature using the raw body and secret.
    let event;
    let signature = req.headers["stripe-signature"];
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log(`⚠️  Webhook signature verification failed.`);
      return res.sendStatus(400);
    }
    data = event.data;
    eventType = event.type;
  } else {
    // Webhook signing is recommended, but if the secret is not configured in `config.js`,
    // we can retrieve the event data directly from the request body.
    data = req.body.data;
    eventType = req.body.type;
  }

  // Successfully constructed event
  switch (eventType) {
    case "identity.verification_session.verified": {
      // All the verification checks passed
      const verificationSession = data.object;
      console.log(
        `All the verification checks passed ${JSON.stringify(
          verificationSession
        )}`
      );
      break;
    }
    case "identity.verification_session.requires_input": {
      // At least one of the verification checks failed
      const verificationSession = data.object;

      console.log(
        "identity verification session requires input" +
          verificationSession.last_error.reason
      );

      // Handle specific failure reasons
      switch (verificationSession.last_error.code) {
        case "document_unverified_other": {
          // The document was invalid
          console.log(verificationSession.last_error.reason);
          break;
        }
        case "document_expired": {
          // The document was expired
          console.log(verificationSession.last_error.reason);

          break;
        }
        case "document_type_not_supported": {
          // document type not supported
          console.log(verificationSession.last_error.reason);
          break;
        }
        default: {
          console.log(verificationSession.last_error.reason);
        }
      }
    }
  }
  res.sendStatus(200);
});

app.listen(4242, () =>
  console.log(`Node server listening at http://localhost:4242`)
);

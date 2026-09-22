// Live smoke test of the Jev judge. Needs TYPESAFE_API_KEY; not part of `pnpm check`.
//   pnpm tsx scripts/judge-smoke.ts
import { createJudge } from "../src/judge";

const judge = createJudge();
const result = await judge.whichApi("stripe", [
  {
    id: "stripe.com/stripe-api",
    name: "Stripe API",
    vendor: "Stripe",
    description: "Payments, billing and financial services API",
  },
  {
    id: "stripe.com/stripe-apps",
    name: "Stripe Apps",
    vendor: "Stripe",
    description: "Extension platform for building apps in the Stripe Dashboard",
  },
]);
console.log(JSON.stringify(result, null, 2));

const vendorName = await judge.isVendorName("mailchimp", {
  id: "mailchimp.com",
  name: "Mailchimp",
});
console.log(
  `isVendorName("mailchimp", mailchimp.com): ${JSON.stringify(vendorName)}`,
);

const vendorApiLink = await judge.isVendorApiLink(
  { id: "mailchimp.com", name: "Mailchimp" },
  {
    url: "https://mailchimp.com/developer/marketing/",
    text: "Marketing API",
    context: "Mailchimp Developer",
  },
);
console.log(
  `isVendorApiLink(mailchimp.com, "Marketing API"): ${JSON.stringify(vendorApiLink)}`,
);

import React from "react";
import { render } from "@testing-library/react";
import axe from "axe-core";
import Button from "@/components/primitives/Button";
import Badge from "@/components/primitives/Badge";
import Input from "@/components/primitives/Input";
import Textarea from "@/components/primitives/Textarea";
import Card from "@/components/primitives/Card";
import StatCard from "@/components/primitives/StatCard";
import StateMessage from "@/components/StateMessage";
import FreelancerTierBadge from "@/components/FreelancerTierBadge";
import ProgressBar from "@/components/Onboarding/ProgressBar";

async function checkA11y(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: {
      // In JSDOM testing, page landmarks are not expected in isolated components
      region: { enabled: false },
      "page-has-heading-one": { enabled: false },
    },
  });

  const seriousViolations = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical"
  );

  return {
    violations: seriousViolations,
    allViolations: results.violations,
  };
}

describe("Automated Accessibility (a11y) Verification", () => {
  it("Button has zero serious accessibility violations", async () => {
    const { container } = render(
      <div>
        <Button variant="primary">Submit Application</Button>
        <Button variant="secondary" aria-label="Cancel proposal">
          Cancel
        </Button>
      </div>
    );
    const { violations } = await checkA11y(container);
    expect(violations).toEqual([]);
  });

  it("Badge has zero serious accessibility violations", async () => {
    const { container } = render(
      <div>
        <Badge variant="open" dot>
          Open
        </Badge>
        <Badge variant="complete">Completed</Badge>
      </div>
    );
    const { violations } = await checkA11y(container);
    expect(violations).toEqual([]);
  });

  it("Input and Textarea have proper accessible labels and pass a11y checks", async () => {
    const { container } = render(
      <div>
        <Input label="Project Title" id="title" placeholder="Enter title" />
        <Textarea label="Proposal Details" id="proposal" placeholder="Describe proposal" />
      </div>
    );
    const { violations } = await checkA11y(container);
    expect(violations).toEqual([]);
  });

  it("Card and StatCard have zero serious accessibility violations", async () => {
    const { container } = render(
      <div>
        <Card header={<h2>Escrow Overview</h2>}>
          <p>Locked balance: 500 XLM</p>
        </Card>
        <StatCard
          title="Active Escrows"
          value="12"
          subtitle="All operating normally"
          colorScheme="gold"
        />
      </div>
    );
    const { violations } = await checkA11y(container);
    expect(violations).toEqual([]);
  });

  it("StateMessage and FreelancerTierBadge have zero serious accessibility violations", async () => {
    const { container } = render(
      <div>
        <StateMessage
          type="empty"
          title="No Active Jobs"
          description="You currently have no open job listings."
          ctaLabel="Create Job"
          onCta={() => {}}
        />
        <FreelancerTierBadge tier="Top Rated" />
        <ProgressBar current={2} total={4} />
      </div>
    );
    const { violations } = await checkA11y(container);
    expect(violations).toEqual([]);
  });
});

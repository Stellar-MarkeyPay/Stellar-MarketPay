import React from "react";
import { render } from "@testing-library/react";
import Button from "@/components/primitives/Button";
import Badge from "@/components/primitives/Badge";
import Modal from "@/components/primitives/Modal";
import Input from "@/components/primitives/Input";
import Textarea from "@/components/primitives/Textarea";
import Card from "@/components/primitives/Card";
import Skeleton from "@/components/primitives/Skeleton";
import StatCard from "@/components/primitives/StatCard";
import Spinner from "@/components/Spinner";
import StateMessage from "@/components/StateMessage";
import FreelancerTierBadge from "@/components/FreelancerTierBadge";
import FreelancerProfileSkeleton from "@/components/FreelancerProfileSkeleton";
import ProgressBar from "@/components/Onboarding/ProgressBar";
import JobCompletionPredictionPanel from "@/components/JobCompletionPrediction";

describe("Primitives and Story Snapshot Regression Tests", () => {
  it("renders Button variants and sizes", () => {
    const { container: primary } = render(<Button variant="primary">Primary Button</Button>);
    expect(primary.firstChild).toMatchSnapshot();

    const { container: secondary } = render(<Button variant="secondary">Secondary Button</Button>);
    expect(secondary.firstChild).toMatchSnapshot();

    const { container: ghost } = render(<Button variant="ghost">Ghost Button</Button>);
    expect(ghost.firstChild).toMatchSnapshot();

    const { container: danger } = render(<Button variant="danger">Danger Button</Button>);
    expect(danger.firstChild).toMatchSnapshot();

    const { container: loading } = render(<Button isLoading>Loading Button</Button>);
    expect(loading.firstChild).toMatchSnapshot();
  });

  it("renders Badge variants", () => {
    const { container: open } = render(
      <Badge variant="open" dot>
        Open
      </Badge>
    );
    expect(open.firstChild).toMatchSnapshot();

    const { container: progress } = render(
      <Badge variant="progress" dot>
        In Progress
      </Badge>
    );
    expect(progress.firstChild).toMatchSnapshot();

    const { container: complete } = render(
      <Badge variant="complete" dot>
        Complete
      </Badge>
    );
    expect(complete.firstChild).toMatchSnapshot();

    const { container: gold } = render(<Badge variant="gold">⚡ Featured</Badge>);
    expect(gold.firstChild).toMatchSnapshot();
  });

  it("renders Modal when open", () => {
    const { container } = render(
      <Modal
        isOpen={true}
        onClose={() => {}}
        title="Escrow Confirmation"
        description="Verify transaction details before signing"
        footer={<Button size="sm">Confirm</Button>}
      >
        <p>Escrow amount: 500 XLM</p>
      </Modal>
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("renders Input with label and error states", () => {
    const { container: normal } = render(
      <Input label="Project Title" placeholder="Enter title" helperText="Helpful tip" />
    );
    expect(normal.firstChild).toMatchSnapshot();

    const { container: error } = render(
      <Input label="Budget" value="-10" error="Budget must be greater than 0" />
    );
    expect(error.firstChild).toMatchSnapshot();
  });

  it("renders Textarea with char count", () => {
    const { container } = render(
      <Textarea
        label="Description"
        value="Detailed proposal specifications."
        maxLength={200}
        showCharCount
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("renders Card container and hover states", () => {
    const { container } = render(
      <Card hoverable header={<h3>Card Title</h3>} footer={<p>Footer</p>}>
        <p>Card body content</p>
      </Card>
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("renders Skeleton variants", () => {
    const { container: text } = render(<Skeleton variant="text" width="80%" />);
    expect(text.firstChild).toMatchSnapshot();

    const { container: circle } = render(<Skeleton variant="circle" width={48} height={48} />);
    expect(circle.firstChild).toMatchSnapshot();

    const { container: card } = render(<Skeleton variant="card" />);
    expect(card.firstChild).toMatchSnapshot();
  });

  it("renders StatCard with trend indicator", () => {
    const { container } = render(
      <StatCard
        title="Total Earnings"
        value="12,500 XLM"
        subtitle="Ranked in top 5%"
        change={{ value: "+18%", trend: "up" }}
        colorScheme="green"
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("renders StateMessage empty and error states", () => {
    const { container: empty } = render(
      <StateMessage
        type="empty"
        title="No Bids Found"
        description="Check back soon for new proposals."
        ctaLabel="Browse Other Jobs"
        onCta={() => {}}
      />
    );
    expect(empty.firstChild).toMatchSnapshot();

    const { container: err } = render(
      <StateMessage
        type="error"
        title="Connection Failed"
        description="Could not connect to Soroban RPC."
      />
    );
    expect(err.firstChild).toMatchSnapshot();
  });

  it("renders FreelancerProfileSkeleton and ProgressBar", () => {
    const { container: skeleton } = render(<FreelancerProfileSkeleton />);
    expect(skeleton.firstChild).toMatchSnapshot();

    const { container: progress } = render(<ProgressBar current={3} total={4} />);
    expect(progress.firstChild).toMatchSnapshot();
  });

  it("renders JobCompletionPredictionPanel", () => {
    const { container } = render(
      <JobCompletionPredictionPanel
        prediction={{
          estimatedDurationDays: 10,
          estimatedCompletionDate: "2026-05-01T00:00:00.000Z",
          confidenceScore: 85,
          freelancerStats: {
            completedJobs: 15,
            rating: 4.8,
            onTimeRate: 94,
          },
        }}
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

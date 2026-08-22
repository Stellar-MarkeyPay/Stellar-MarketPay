import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeeEstimationModal from "@/components/FeeEstimationModal";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockEstimateSorobanFee = jest.fn();
const mockDescribeContractCall = jest.fn(
  (fnName: string) => fnName.replace(/_/g, " ")
);
const mockGetXLMBalance = jest.fn();
const mockOnConfirm = jest.fn();
const mockOnCancel = jest.fn();

jest.mock("@/lib/sorobanFees", () => ({
  estimateSorobanFee: (...args: unknown[]) => mockEstimateSorobanFee(...args),
  describeContractCall: (fnName: string) => mockDescribeContractCall(fnName),
}));

jest.mock("@/lib/stellar", () => ({
  getXLMBalance: (...args: unknown[]) => mockGetXLMBalance(...args),
}));

jest.mock("@/contexts/PriceContext", () => ({
  usePriceContext: () => ({ xlmPriceUsd: 0.12 }),
}));

jest.mock("next/router", () => ({
  useRouter: () => ({
    pathname: "/",
    push: jest.fn(),
    query: {},
    isReady: true,
  }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

jest.mock("@/lib/api", () => ({
  fetchNotificationPreferences: jest.fn().mockResolvedValue({
    notificationTypes: [],
    preferences: {},
  }),
  fetchNotifications: jest.fn().mockResolvedValue({
    notifications: [],
    unreadCount: 0,
    nextCursor: null,
  }),
  markAllNotificationsRead: jest.fn().mockResolvedValue({ updatedCount: 0 }),
  markNotificationRead: jest.fn().mockResolvedValue({}),
  submitRating: jest.fn().mockResolvedValue({}),
  updateNotificationPreferences: jest.fn().mockResolvedValue({}),
}));

// Stub Transaction — only the props the component touches are needed.
const fakeTransaction = { fee: "1000" } as any;

function renderModal(overrides: Partial<React.ComponentProps<typeof FeeEstimationModal>> = {}) {
  return render(
    <FeeEstimationModal
      transaction={fakeTransaction}
      functionName="create_escrow"
      payerPublicKey="GABUYER1234567890EXAMPLEABCDEFGHIJKLMNOPQRSTUVWX"
      onConfirm={mockOnConfirm}
      onCancel={mockOnCancel}
      {...overrides}
    />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: successful fee estimation and balance
  mockEstimateSorobanFee.mockResolvedValue({
    totalStroops: BigInt(100_000),
    totalXlm: "0.01",
    totalUsd: 0.0012,
    resourceFeeStroops: BigInt(90_000),
    inclusionFeeStroops: BigInt(10_000),
  });
  mockGetXLMBalance.mockResolvedValue("10.0");
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("FeeEstimationModal", () => {
  // ── Loading state ────────────────────────────────────────────────────────

  it("shows a loading indicator while the fee is being estimated", async () => {
    // Never resolve so the loading state persists
    mockEstimateSorobanFee.mockReturnValue(new Promise(() => {}));
    mockGetXLMBalance.mockReturnValue(new Promise(() => {}));

    renderModal();

    expect(
      screen.getByText(/simulating contract call/i)
    ).toBeInTheDocument();
  });

  // ── Success path ─────────────────────────────────────────────────────────

  it("displays fee breakdown after estimation succeeds", async () => {
    await act(async () => {
      renderModal();
    });

    // Title is shown
    expect(screen.getByRole("heading", { name: /confirm transaction/i })).toBeInTheDocument();

    // Function name is listed
    expect(screen.getByText("create_escrow")).toBeInTheDocument();

    // Fee amount in XLM
    expect(screen.getByText(/0\.01 XLM/)).toBeInTheDocument();

    // USD equivalent
    expect(screen.getByText(/\$0\.0012 USD/)).toBeInTheDocument();

    // Wallet balance
    expect(screen.getByText(/10.*XLM/)).toBeInTheDocument();
  });

  it("enables the Confirm button once estimation succeeds", async () => {
    await act(async () => {
      renderModal();
    });

    const confirmBtn = screen.getByRole("button", { name: /confirm & sign/i });
    expect(confirmBtn).toBeEnabled();
  });

  it("calls onConfirm when the Confirm button is clicked", async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderModal();
    });

    const confirmBtn = screen.getByRole("button", { name: /confirm & sign/i });
    await user.click(confirmBtn);

    expect(mockOnConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the Cancel button is clicked", async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderModal();
    });

    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    await user.click(cancelBtn);

    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  // ── Error path ───────────────────────────────────────────────────────────

  it("shows an error message when fee estimation fails", async () => {
    mockEstimateSorobanFee.mockRejectedValue(new Error("Simulation failed: contract rejected"));

    await act(async () => {
      renderModal();
    });

    expect(screen.getByText("Simulation failed: contract rejected")).toBeInTheDocument();
  });

  it("disables the Confirm button when there is an error", async () => {
    mockEstimateSorobanFee.mockRejectedValue(new Error("Network timeout"));

    await act(async () => {
      renderModal();
    });

    const confirmBtn = screen.getByRole("button", { name: /confirm & sign/i });
    expect(confirmBtn).toBeDisabled();
  });

  it("displays a generic error for non-Error rejections", async () => {
    mockEstimateSorobanFee.mockRejectedValue("something went wrong");

    await act(async () => {
      renderModal();
    });

    expect(screen.getByText("Could not estimate fee.")).toBeInTheDocument();
  });

  // ── Insufficient balance ─────────────────────────────────────────────────

  it("warns when the wallet balance is below the estimated fee", async () => {
    mockGetXLMBalance.mockResolvedValue("0.001"); // less than 0.01 fee

    await act(async () => {
      renderModal();
    });

    expect(
      screen.getByText(/insufficient balance/i)
    ).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: /confirm & sign/i });
    expect(confirmBtn).toBeDisabled();
  });

  it("does not warn when the wallet balance covers the fee", async () => {
    mockGetXLMBalance.mockResolvedValue("100.0");

    await act(async () => {
      renderModal();
    });

    expect(screen.queryByText(/insufficient balance/i)).not.toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: /confirm & sign/i });
    expect(confirmBtn).toBeEnabled();
  });

  // ── Balance fallback ─────────────────────────────────────────────────────

  it("shows a dash when balance fetch returns nothing", async () => {
    mockGetXLMBalance.mockResolvedValue(null);

    await act(async () => {
      renderModal();
    });

    // The component renders "—" when balance is falsy
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // ── describeContractCall integration ──────────────────────────────────────

  it("shows a human-readable label for known function names", async () => {
    mockDescribeContractCall.mockReturnValue("Lock job budget in escrow");

    await act(async () => {
      renderModal({ functionName: "create_escrow" });
    });

    // The label is embedded inside the <p> subtitle, so use a partial match
    expect(
      screen.getByText(/Lock job budget in escrow/)
    ).toBeInTheDocument();
  });

  // ── Keyboard interaction ─────────────────────────────────────────────────

  it("allows the user to Tab between Cancel and Confirm buttons", async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderModal();
    });

    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    const confirmBtn = screen.getByRole("button", { name: /confirm & sign/i });

    // Tab to Cancel
    await user.tab();
    expect(cancelBtn).toHaveFocus();

    // Tab to Confirm
    await user.tab();
    expect(confirmBtn).toHaveFocus();
  });

  it("fires onCancel when Enter is pressed on the focused Cancel button", async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderModal();
    });

    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    cancelBtn.focus();
    await user.keyboard("{Enter}");

    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it("fires onConfirm when Enter is pressed on the focused Confirm button", async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderModal();
    });

    const confirmBtn = screen.getByRole("button", { name: /confirm & sign/i });
    confirmBtn.focus();
    await user.keyboard("{Enter}");

    expect(mockOnConfirm).toHaveBeenCalledTimes(1);
  });

  // ── Estimate cleanup ─────────────────────────────────────────────────────

  it("does not set state after unmount (cancelled flag)", async () => {
    // Slow resolve — will resolve after component unmounts
    let resolveEstimate!: (value: any) => void;
    mockEstimateSorobanFee.mockReturnValue(
      new Promise((r) => { resolveEstimate = r; })
    );

    const { unmount } = renderModal();

    unmount();

    // Resolve after unmount — should not throw
    await act(async () => {
      resolveEstimate({
        totalStroops: BigInt(100_000),
        totalXlm: "0.01",
        totalUsd: 0.0012,
        resourceFeeStroops: BigInt(90_000),
        inclusionFeeStroops: BigInt(10_000),
      });
    });

    // No error thrown means the cancelled guard worked.
    expect(mockEstimateSorobanFee).toHaveBeenCalled();
  });
});

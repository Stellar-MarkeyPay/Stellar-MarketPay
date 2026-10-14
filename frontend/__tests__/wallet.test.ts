import { connectWallet, isFreighterInstalled, getConnectedPublicKey } from "../lib/wallet";
import { getNetworkDetails, isConnected, getPublicKey, requestAccess, isAllowed } from "@stellar/freighter-api";

jest.mock("@stellar/freighter-api", () => ({
  isConnected: jest.fn(),
  getPublicKey: jest.fn(),
  requestAccess: jest.fn(),
  isAllowed: jest.fn(),
  getNetworkDetails: jest.fn(),
}));

describe("Freighter wallet error modes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).window = {};
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = "testnet";
  });

  it("handles extension absent", async () => {
    (isConnected as jest.Mock).mockResolvedValue(false);
    
    const result = await connectWallet();
    expect(result.errorCode).toBe("NOT_INSTALLED");
    expect(result.error).toMatch(/install the extension/i);
    expect(result.publicKey).toBeNull();
  });

  it("handles user rejection", async () => {
    (isConnected as jest.Mock).mockResolvedValue(true);
    (getNetworkDetails as jest.Mock).mockResolvedValue({ networkPassphrase: "Test SDF Network ; September 2015" });
    (requestAccess as jest.Mock).mockRejectedValue(new Error("User declined access"));
    
    const result = await connectWallet();
    expect(result.errorCode).toBe("USER_REJECTED");
    expect(result.error).toMatch(/rejected/i);
  });

  it("handles network mismatch", async () => {
    (isConnected as jest.Mock).mockResolvedValue(true);
    (getNetworkDetails as jest.Mock).mockResolvedValue({ networkPassphrase: "Public Global Stellar Network ; September 2015" });
    
    const result = await connectWallet();
    expect(result.errorCode).toBe("NETWORK_MISMATCH");
    expect(result.error).toMatch(/Network mismatch/i);
  });

  it("handles wallet locked during connect", async () => {
    (isConnected as jest.Mock).mockResolvedValue(true);
    (getNetworkDetails as jest.Mock).mockResolvedValue({ networkPassphrase: "Test SDF Network ; September 2015" });
    (requestAccess as jest.Mock).mockRejectedValue(new Error("wallet is locked"));
    
    const result = await connectWallet();
    expect(result.errorCode).toBe("LOCKED");
    expect(result.error).toMatch(/locked/i);
  });

  it("handles account switched mid-session (getConnectedPublicKey returns new or null)", async () => {
    (isAllowed as jest.Mock).mockResolvedValue(true);
    (getNetworkDetails as jest.Mock).mockResolvedValue({ networkPassphrase: "Test SDF Network ; September 2015" });
    (getPublicKey as jest.Mock).mockResolvedValue("NEW_PUBLIC_KEY");
    
    const pk = await getConnectedPublicKey();
    expect(pk).toBe("NEW_PUBLIC_KEY");
  });
});

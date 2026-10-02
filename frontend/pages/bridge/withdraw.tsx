import { useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Navbar from "../../components/Navbar";
import BridgeTransferStatus from "../../components/BridgeTransferStatus";
import BridgeFeeEstimate from "../../components/BridgeFeeEstimate";

export default function WithdrawBridge() {
  const router = useRouter();
  const { jobId } = router.query;
  const [amount, setAmount] = useState("");
  const [evmAddress, setEvmAddress] = useState("");
  const [selectedChain, setSelectedChain] = useState("ethereum");
  const [transferStatus, setTransferStatus] = useState<"idle" | "pending" | "processing" | "complete" | "error">("idle");
  const [estimatedTime, setEstimatedTime] = useState("~5 minutes");
  const [error, setError] = useState("");

  const handleWithdraw = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }
    if (!evmAddress || !evmAddress.startsWith("0x")) {
      setError("Please enter a valid EVM address");
      return;
    }
    if (!jobId || typeof jobId !== "string") {
      setError("Missing job ID");
      return;
    }

    setError("");
    setTransferStatus("pending");

    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setTransferStatus("processing");

      await new Promise((resolve) => setTimeout(resolve, 3000));

      setTransferStatus("complete");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to initiate withdrawal");
      setTransferStatus("error");
    }
  };

  return (
    <div>
      <Head>
        <title>Withdraw to EVM — MarketPay</title>
      </Head>
      <Navbar publicKey={null} onConnect={() => {}} onDisconnect={() => {}} />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-2">Withdraw to EVM Chain</h1>
        <p className="text-gray-600 mb-6">
          Receive your payment on an EVM chain of your choice.
        </p>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {transferStatus === "idle" && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium mb-2">Amount</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border rounded-lg px-4 py-3"
                placeholder="0.00"
                step="0.0000001"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">EVM Address</label>
              <input
                type="text"
                value={evmAddress}
                onChange={(e) => setEvmAddress(e.target.value)}
                className="w-full border rounded-lg px-4 py-3"
                placeholder="0x..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Destination Chain</label>
              <select
                value={selectedChain}
                onChange={(e) => setSelectedChain(e.target.value)}
                className="w-full border rounded-lg px-4 py-3"
              >
                <option value="ethereum">Ethereum</option>
                <option value="polygon">Polygon</option>
                <option value="arbitrum">Arbitrum</option>
                <option value="optimism">Optimism</option>
              </select>
            </div>

            <BridgeFeeEstimate
              amount={amount}
              chain={selectedChain}
              isWithdrawal={true}
              estimatedTime={estimatedTime}
            />

            <button
              onClick={handleWithdraw}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700"
            >
              Initiate Withdrawal
            </button>
          </div>
        )}

        {transferStatus === "complete" && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-green-800 mb-2">Withdrawal Initiated</h2>
            <p className="text-green-700">Your funds are being processed to the EVM chain.</p>
            <button
              onClick={() => router.push(`/jobs/${jobId}`)}
              className="mt-4 bg-green-600 text-white px-6 py-2 rounded-lg"
            >
              View Job
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

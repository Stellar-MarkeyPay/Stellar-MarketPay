/**
 * pages/post-job.tsx
 */
import { useRouter } from "next/router";
import WalletConnect from "@/components/WalletConnect";
import PostJobForm from "@/components/PostJobForm";
import Link from "next/link";

interface PostJobProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

export default function PostJob({ publicKey, onConnect }: PostJobProps) {
  const router = useRouter();

  const category = typeof router.query.category === "string" ? router.query.category : "";

  const suggestedFreelancer =
    typeof router.query.freelancer === "string" ? router.query.freelancer : "";

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      {!publicKey ? (
        <div>
          <div className="text-center mb-10">
            <h1 className="font-display text-3xl font-bold text-amber-100 mb-3">Post a Job</h1>
            <p className="text-amber-800">
              Connect your wallet to post a job and lock the budget in escrow
            </p>
          </div>
          <WalletConnect onConnect={onConnect} />
        </div>
      ) : (
        <PostJobForm
          publicKey={publicKey}
          initialCategory={category}
          suggestedFreelancer={suggestedFreelancer}
        />
      )}
        <div className="mt-8">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-500">Or</span>
            </div>
          </div>
          <div className="mt-6">
            <Link
              href={`/bridge/fund?jobId=${router.query.id || ""}`}
              className="block w-full text-center bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700"
            >
              Fund from EVM via Bridge
            </Link>
          </div>
        </div>
    </div>
  );
}

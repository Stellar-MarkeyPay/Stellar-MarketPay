import axios from "axios";
import type {
  Job,
  Application,
  UserProfile,
  CreateJobInput,
  SubmitApplicationInput,
  UpsertProfileInput,
  BridgeTransfer,
} from "@marketpay/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const client = axios.create({
  baseURL: `${API_BASE}/api`,
  withCredentials: true,
});

client.interceptors.request.use((config) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("smp_jwt") : undefined;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export async function fetchJobs() {
  const { data } = await client.get("/jobs");
  return data.jobs as Job[];
}

export async function fetchJob(jobId: string) {
  const { data } = await client.get(`/jobs/${jobId}`);
  return data.job as Job;
}

export async function createJob(input: CreateJobInput) {
  const { data } = await client.post("/jobs", input);
  return data.job as Job;
}

export async function updateJob(jobId: string, input: Partial<Job>) {
  const { data } = await client.put(`/jobs/${jobId}`, input);
  return data.job as Job;
}

export async function deleteJob(jobId: string) {
  await client.delete(`/jobs/${jobId}`);
}

export async function fetchApplications(jobId: string) {
  const { data } = await client.get(`/applications?jobId=${jobId}`);
  return data.applications as Application[];
}

export async function submitApplication(input: SubmitApplicationInput) {
  const { data } = await client.post("/applications", input);
  return data.application as Application;
}

export async function fetchProfile(publicKey: string) {
  const { data } = await client.get(`/profiles/${publicKey}`);
  return data.profile as UserProfile;
}

export async function upsertProfile(input: UpsertProfileInput) {
  const { data } = await client.put("/profiles/me", input);
  return data.profile as UserProfile;
}

export async function fetchBridgeTransfers() {
  const { data } = await client.get("/bridge/transfers");
  return data.transfers as BridgeTransfer[];
}

export async function recoverBridgeTransfer(transferId: string) {
  const { data } = await client.post(`/bridge/recover/${transferId}`);
  return data;
}

export { client as apiClient };

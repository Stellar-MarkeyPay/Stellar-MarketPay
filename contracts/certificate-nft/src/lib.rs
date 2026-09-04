#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String, Vec,
};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Certificate {
    pub id: u32,
    pub cert_type: u32, // 1 = JobCompletion, 2 = SkillAssessment
    pub recipient: Address,
    pub issuer: Address,
    pub job_id: String,
    pub title: String,
    pub metadata_uri: String,
    pub issued_at_ledger: u32,
    pub revoked: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Name,
    Symbol,
    TotalMinted,
    Certificate(u32),
    RecipientCerts(Address),
    JobCertificate(String),
    AuthorizedIssuer(Address),
}

#[contract]
pub struct CertificateContract;

#[contractimpl]
impl CertificateContract {
    /// Initialize the Certificate NFT Contract.
    pub fn initialize(env: Env, admin: Address, name: String, symbol: String) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::TotalMinted, &0u32);

        // Admin is by default an authorized issuer
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedIssuer(admin.clone()), &true);

        env.events()
            .publish((symbol_short!("init"), admin), (name, symbol));
    }

    /// Set a new contract admin.
    pub fn set_admin(env: Env, admin: Address, new_admin: Address) {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            panic!("Only current admin can transfer admin");
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events().publish((symbol_short!("set_adm"), admin), new_admin);
    }

    /// Return admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized")
    }

    /// Authorize or revoke an issuer address (e.g. MarketPay contract or assessment service).
    pub fn set_authorized_issuer(env: Env, admin: Address, issuer: Address, authorized: bool) {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            panic!("Only admin can manage issuers");
        }
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::AuthorizedIssuer(issuer.clone()), &authorized);

        env.events()
            .publish((symbol_short!("issuer"), admin), (issuer, authorized));
    }

    /// Check if an address is an authorized certificate issuer.
    pub fn is_authorized_issuer(env: Env, issuer: Address) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::AuthorizedIssuer(issuer))
            .unwrap_or(false)
    }

    /// Mint a job completion certificate for a freelancer upon escrow release.
    /// Soulbound: Certificate is bound permanently to the freelancer recipient.
    pub fn mint_completion_certificate(
        env: Env,
        issuer: Address,
        recipient: Address,
        job_id: String,
        title: String,
        metadata_uri: String,
    ) -> u32 {
        if !Self::is_authorized_issuer(env.clone(), issuer.clone()) {
            panic!("Caller is not authorized issuer");
        }
        issuer.require_auth();

        // Enforce uniqueness per job
        if env
            .storage()
            .instance()
            .has(&DataKey::JobCertificate(job_id.clone()))
        {
            panic!("Certificate already minted for this job");
        }

        let cert_id = Self::next_id(&env);

        let cert = Certificate {
            id: cert_id,
            cert_type: 1, // JobCompletion
            recipient: recipient.clone(),
            issuer: issuer.clone(),
            job_id: job_id.clone(),
            title,
            metadata_uri,
            issued_at_ledger: env.ledger().sequence(),
            revoked: false,
        };

        env.storage()
            .instance()
            .set(&DataKey::Certificate(cert_id), &cert);
        env.storage()
            .instance()
            .set(&DataKey::JobCertificate(job_id.clone()), &cert_id);

        Self::add_recipient_cert(&env, &recipient, cert_id);

        env.events().publish(
            (symbol_short!("cert_job"), issuer),
            (recipient, cert_id, job_id),
        );

        cert_id
    }

    /// Mint a verified skill assessment certificate.
    pub fn mint_skill_certificate(
        env: Env,
        issuer: Address,
        recipient: Address,
        skill_name: String,
        metadata_uri: String,
    ) -> u32 {
        if !Self::is_authorized_issuer(env.clone(), issuer.clone()) {
            panic!("Caller is not authorized issuer");
        }
        issuer.require_auth();

        let cert_id = Self::next_id(&env);

        let cert = Certificate {
            id: cert_id,
            cert_type: 2, // SkillAssessment
            recipient: recipient.clone(),
            issuer: issuer.clone(),
            job_id: String::from_str(&env, ""),
            title: skill_name.clone(),
            metadata_uri,
            issued_at_ledger: env.ledger().sequence(),
            revoked: false,
        };

        env.storage()
            .instance()
            .set(&DataKey::Certificate(cert_id), &cert);

        Self::add_recipient_cert(&env, &recipient, cert_id);

        env.events().publish(
            (symbol_short!("cert_skl"), issuer),
            (recipient, cert_id, skill_name),
        );

        cert_id
    }

    /// Revoke a certificate in case of fraud or dispute.
    pub fn revoke_certificate(env: Env, admin: Address, cert_id: u32, reason: String) {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            panic!("Only admin can revoke certificates");
        }
        admin.require_auth();

        let mut cert: Certificate = env
            .storage()
            .instance()
            .get(&DataKey::Certificate(cert_id))
            .expect("Certificate not found");

        if cert.revoked {
            panic!("Certificate already revoked");
        }

        cert.revoked = true;
        env.storage()
            .instance()
            .set(&DataKey::Certificate(cert_id), &cert);

        env.events()
            .publish((symbol_short!("revoked"), admin), (cert_id, reason));
    }

    /// Fetch certificate data.
    pub fn get_certificate(env: Env, cert_id: u32) -> Certificate {
        env.storage()
            .instance()
            .get(&DataKey::Certificate(cert_id))
            .expect("Certificate not found")
    }

    /// Check if certificate exists and is not revoked.
    pub fn is_valid(env: Env, cert_id: u32) -> bool {
        if let Some(cert) = env
            .storage()
            .instance()
            .get::<_, Certificate>(&DataKey::Certificate(cert_id))
        {
            !cert.revoked
        } else {
            false
        }
    }

    /// Return owner/recipient of a certificate.
    pub fn owner_of(env: Env, cert_id: u32) -> Address {
        let cert: Certificate = env
            .storage()
            .instance()
            .get(&DataKey::Certificate(cert_id))
            .expect("Certificate not found");
        cert.recipient
    }

    /// Return metadata URI for token.
    pub fn token_uri(env: Env, cert_id: u32) -> String {
        let cert: Certificate = env
            .storage()
            .instance()
            .get(&DataKey::Certificate(cert_id))
            .expect("Certificate not found");
        cert.metadata_uri
    }

    /// Fetch all certificate IDs owned by a freelancer.
    pub fn get_freelancer_certificates(env: Env, freelancer: Address) -> Vec<u32> {
        env.storage()
            .instance()
            .get(&DataKey::RecipientCerts(freelancer))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Look up certificate ID by job ID.
    pub fn get_job_certificate(env: Env, job_id: String) -> Option<u32> {
        env.storage()
            .instance()
            .get(&DataKey::JobCertificate(job_id))
    }

    /// Total number of certificates minted.
    pub fn total_supply(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TotalMinted)
            .unwrap_or(0)
    }

    pub fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "MarketPay Certificate"))
    }

    pub fn symbol(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "MPCERT"))
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    fn next_id(env: &Env) -> u32 {
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TotalMinted)
            .unwrap_or(0);
        let next = count.checked_add(1).expect("Certificate count overflow");
        env.storage().instance().set(&DataKey::TotalMinted, &next);
        next
    }

    fn add_recipient_cert(env: &Env, recipient: &Address, cert_id: u32) {
        let mut list: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::RecipientCerts(recipient.clone()))
            .unwrap_or_else(|| Vec::new(env));
        list.push_back(cert_id);
        env.storage()
            .instance()
            .set(&DataKey::RecipientCerts(recipient.clone()), &list);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_initialize_and_metadata() {
        let env = Env::default();
        let contract_id = env.register(CertificateContract, ());
        let client = CertificateContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.mock_all_auths();

        let name = String::from_str(&env, "MarketPay Certificate");
        let symbol = String::from_str(&env, "MPCERT");
        client.initialize(&admin, &name, &symbol);

        assert_eq!(client.name(), name);
        assert_eq!(client.symbol(), symbol);
        assert_eq!(client.total_supply(), 0);
        assert_eq!(client.get_admin(), admin);
        assert!(client.is_authorized_issuer(&admin));
    }

    #[test]
    fn test_mint_and_query_completion_certificate() {
        let env = Env::default();
        let contract_id = env.register(CertificateContract, ());
        let client = CertificateContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let escrow_contract = Address::generate(&env);
        env.mock_all_auths();

        let name = String::from_str(&env, "MarketPay Certificate");
        let symbol = String::from_str(&env, "MPCERT");
        client.initialize(&admin, &name, &symbol);

        // Authorize escrow contract as issuer
        client.set_authorized_issuer(&admin, &escrow_contract, &true);
        assert!(client.is_authorized_issuer(&escrow_contract));

        let job_id = String::from_str(&env, "job-101");
        let title = String::from_str(&env, "Smart Contract Development");
        let uri = String::from_str(&env, "ipfs://QmCertHash101");

        let cert_id = client.mint_completion_certificate(
            &escrow_contract,
            &freelancer,
            &job_id,
            &title,
            &uri,
        );

        assert_eq!(cert_id, 1);
        assert_eq!(client.total_supply(), 1);
        assert_eq!(client.owner_of(&cert_id), freelancer);
        assert_eq!(client.token_uri(&cert_id), uri);
        assert!(client.is_valid(&cert_id));

        let cert = client.get_certificate(&cert_id);
        assert_eq!(cert.id, 1);
        assert_eq!(cert.cert_type, 1);
        assert_eq!(cert.recipient, freelancer);
        assert_eq!(cert.job_id, job_id);
        assert_eq!(cert.title, title);
        assert!(!cert.revoked);

        let certs = client.get_freelancer_certificates(&freelancer);
        assert_eq!(certs.len(), 1);
        assert_eq!(certs.get(0).unwrap(), 1);

        assert_eq!(client.get_job_certificate(&job_id), Some(1));
    }

    #[test]
    #[should_panic(expected = "Certificate already minted for this job")]
    fn test_duplicate_job_certificate_panics() {
        let env = Env::default();
        let contract_id = env.register(CertificateContract, ());
        let client = CertificateContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let freelancer = Address::generate(&env);
        env.mock_all_auths();

        let name = String::from_str(&env, "MarketPay Certificate");
        let symbol = String::from_str(&env, "MPCERT");
        client.initialize(&admin, &name, &symbol);

        let job_id = String::from_str(&env, "job-duplicate");
        let title = String::from_str(&env, "Frontend Design");
        let uri = String::from_str(&env, "ipfs://QmHash");

        client.mint_completion_certificate(&admin, &freelancer, &job_id, &title, &uri);
        // Minting second time for same job should panic
        client.mint_completion_certificate(&admin, &freelancer, &job_id, &title, &uri);
    }

    #[test]
    fn test_mint_skill_and_revoke() {
        let env = Env::default();
        let contract_id = env.register(CertificateContract, ());
        let client = CertificateContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let freelancer = Address::generate(&env);
        env.mock_all_auths();

        let name = String::from_str(&env, "MarketPay Certificate");
        let symbol = String::from_str(&env, "MPCERT");
        client.initialize(&admin, &name, &symbol);

        let skill_name = String::from_str(&env, "Rust / Soroban");
        let uri = String::from_str(&env, "ipfs://QmSkillAssessmentHash");

        let cert_id = client.mint_skill_certificate(&admin, &freelancer, &skill_name, &uri);
        assert_eq!(cert_id, 1);
        assert!(client.is_valid(&cert_id));

        // Revoke certificate
        let reason = String::from_str(&env, "Fraudulent assessment evidence");
        client.revoke_certificate(&admin, &cert_id, &reason);

        assert!(!client.is_valid(&cert_id));
        let cert = client.get_certificate(&cert_id);
        assert!(cert.revoked);
    }

    #[test]
    #[should_panic(expected = "Caller is not authorized issuer")]
    fn test_unauthorized_issuer_panics() {
        let env = Env::default();
        let contract_id = env.register(CertificateContract, ());
        let client = CertificateContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let unauthorized = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();

        let name = String::from_str(&env, "MarketPay Certificate");
        let symbol = String::from_str(&env, "MPCERT");
        client.initialize(&admin, &name, &symbol);

        let job_id = String::from_str(&env, "job-hack");
        let title = String::from_str(&env, "Hacking Title");
        let uri = String::from_str(&env, "ipfs://QmHack");

        client.mint_completion_certificate(&unauthorized, &recipient, &job_id, &title, &uri);
    }
}

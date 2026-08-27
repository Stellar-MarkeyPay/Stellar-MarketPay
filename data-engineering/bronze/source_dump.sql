--
-- PostgreSQL database dump
--

\restrict slxeQgROxJa6pedUc6k6E7ClYyUhpTVdiAFCSC2pqeoSQSmHed5d919vKfgMuK9

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: admin_profiles; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.admin_profiles (id, email, totp_secret, totp_enabled, backup_codes, totp_attempts, totp_locked_until, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: profiles; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.profiles (public_key, display_name, bio, skills, portfolio_items, availability, role, completed_jobs, total_earned_xlm, rating, created_at, updated_at, reputation_points, referral_count, blocked_addresses, portfolio_files, email, email_notifications_enabled, webhook_url, webhook_secret, is_kyc_verified, did_hash) FROM stdin;
G1CBFNO6B9M80O2RAK1VRJNVGFYGWWQC38HYF9SXMECOSFOGYR3XKXWN	Leila Patel	Experienced client specialising in Node.js, React, Data Engineering. Built 42+ projects on Stellar.	{Node.js,React,"Data Engineering",Solidity}	[]	\N	client	0	0.0000000	\N	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	343	8	{}	[]	\N	t	\N	\N	f	\N
GYR9OUDOCUZRENUN5Z3JQIP98Q1ZXOI65FDHJK1EYY37Q9AH8RVHS1K3	Ines Silva	both focused on AWS, Data Engineering, Node.js. passionate about decentralised finance and open source.	{AWS,"Data Engineering",Node.js}	[]	\N	both	16	14578.3214831	3.01	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	390	5	{}	[]	\N	t	\N	\N	f	\N
GXK87AU5BHXTPDPFF5E8II49KQ71N8MTZX272HPOEVB9OOAEDOECVE6P	Zara Patel	both focused on Flutter, Terraform, Figma. passionate about decentralised finance and open source.	{Flutter,Terraform,Figma,Azure}	[]	\N	both	31	3213.5521106	3.56	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	67	18	{}	[]	\N	t	\N	\N	f	\N
G103DGDZVGPMM82I1LR3PE29GD8AFPK054NZDKYAYQ3S195JMSND8DUD	Nia Kone	client who loves Android, Redis, TypeScript. Active in the Stellar ecosystem since 2021.	{Android,Redis,TypeScript,Solidity,CI/CD}	[]	\N	client	0	0.0000000	\N	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	25	18	{}	[]	\N	t	\N	\N	f	\N
GEPZHPCF07UQNUPQZIT3UEA3GE8N6QIWEPXSK28T7A9TGIQHG9JRSNVN	Jorge Larsson	both focused on Soroban, Figma, Stellar SDK. passionate about decentralised finance and open source.	{Soroban,Figma,"Stellar SDK"}	[]	\N	both	16	7581.1358715	4.37	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	128	1	{}	[]	\N	t	\N	\N	f	\N
GQK2919AHEJ8CX9J1ICTXCWNPGW90JPKL0BLV0PRKGYC4OM3WTOOBMZV	Chen Singh	freelancer focused on Rust, Docker. passionate about decentralised finance and open source.	{Rust,Docker}	[]	\N	freelancer	4	14503.3365607	3.56	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	142	11	{}	[]	\N	t	\N	\N	f	\N
GG1WU16HYMQC1A78MX1EVUHT6T0UZS9IM0YLTZ9ATSN1U322N64KFS6V	Leila Larsson	Freelance freelancer with strong background in Docker, Rust, Solidity. Delivered 7+ successful jobs.	{Docker,Rust,Solidity,Python,Next.js,GCP}	[]	\N	freelancer	15	10091.9350584	3.19	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	115	6	{}	[]	\N	t	\N	\N	f	\N
G0MY5ZPJAG1OL73D9PH3I379U26192K42QPR75PR2ESPRVU8FIJOYJNE	Omar Mensah	Experienced client specialising in Tailwind CSS, Azure, React Native. Built 34+ projects on Stellar.	{"Tailwind CSS",Azure,"React Native"}	[]	\N	client	0	0.0000000	\N	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	212	13	{}	[]	\N	t	\N	\N	f	\N
GY4AWTY088O5OR15BYVZK3I8BZBF1I3LDQYUN3UVYR0QF4B8DWOECBPM	Priya Bello	Experienced freelancer specialising in Soroban, TypeScript, Flutter. Built 41+ projects on Stellar.	{Soroban,TypeScript,Flutter,Redis,PostgreSQL}	[]	\N	freelancer	39	2285.7351868	4.68	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	64	15	{}	[]	\N	t	\N	\N	f	\N
GHKTGBTYZMEPGTHCW81XE6VA05G1X3J1L7R8431RUPFR2P3YVB5UL5NW	Kai Patel	Freelance both with strong background in GraphQL, Machine Learning, Python. Delivered 15+ successful jobs.	{GraphQL,"Machine Learning",Python}	[]	\N	both	21	4194.8773206	4.60	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	305	8	{}	[]	\N	t	\N	\N	f	\N
G9P452BFSOZPTX497W19VW3RTQOHMUH8LMN4R7SGMSOXLTA8IRCD9SI5	Hiro Mensah	both who loves Stellar SDK, Node.js, Data Engineering. Active in the Stellar ecosystem since 2021.	{"Stellar SDK",Node.js,"Data Engineering"}	[]	\N	both	0	8610.9632944	3.21	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	240	15	{}	[]	\N	t	\N	\N	f	\N
GEZ5EDJJTFPH90O7Y22T1TDGNNQFKPL9EKA024SCOSS3EOQM1H8OJRJE	Mei Adeyemi	client who loves Python, React Native. Active in the Stellar ecosystem since 2021.	{Python,"React Native"}	[]	\N	client	0	0.0000000	\N	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	30	5	{}	[]	\N	t	\N	\N	f	\N
G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	Lars Ruiz	both who loves Go, GraphQL, Solidity. Active in the Stellar ecosystem since 2021.	{Go,GraphQL,Solidity,Flutter,"Machine Learning","React Native"}	[]	\N	both	3	3053.3735753	4.25	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	281	4	{}	[]	\N	t	\N	\N	f	\N
GKT9A90FOH3HJ5S6R044P39JYM6IER0V6RAST5J284WV98Y3UMPYO0CU	Lars Andersen	both focused on Solidity, Rust, Terraform. passionate about decentralised finance and open source.	{Solidity,Rust,Terraform,Azure,Android}	[]	\N	both	24	5791.1812874	4.49	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	339	20	{}	[]	\N	t	\N	\N	f	\N
GG73AJ0JE4QVZFV8YU58CEPSOF1GG2KTBCUDSWX1JP70LKLFYP5JO3Q3	Omar Kone	Experienced client specialising in Figma, GCP, Docker. Built 33+ projects on Stellar.	{Figma,GCP,Docker}	[]	\N	client	0	0.0000000	\N	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	130	0	{}	[]	\N	t	\N	\N	f	\N
GQ3TMY4GPYWSSBZRAD5SOWOMQIGCT2CXIFSU0LMI8X76RKQ4SVH3EJOZ	Mei Ivanova	both who loves Next.js, Stellar SDK, GraphQL. Active in the Stellar ecosystem since 2021.	{Next.js,"Stellar SDK",GraphQL,Kubernetes,GCP,Go}	[]	\N	both	35	5486.6257411	4.93	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	404	12	{}	[]	\N	t	\N	\N	f	\N
GYXGO4B9UOE3T0HICCT5HGP8IY3X80J0G50RCXN22PXGX8WDZRMH3FNB	Aisha Johansson	Freelance both with strong background in GraphQL, Kubernetes. Delivered 42+ successful jobs.	{GraphQL,Kubernetes}	[]	\N	both	21	3653.5334575	3.10	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	64	18	{}	[]	\N	t	\N	\N	f	\N
GJARJI8QLHBIAWPUBLQDI07HE42X6G26OC7T3BD4Z1G52EFUJEIR9UY7	Fatima Silva	both focused on GCP, TypeScript, Flutter. passionate about decentralised finance and open source.	{GCP,TypeScript,Flutter}	[]	\N	both	32	9081.4018730	3.59	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	50	3	{}	[]	\N	t	\N	\N	f	\N
G3Z0GU1UQXJ4EFFF1GXI9D99VH0W1DSTWG6NJ4OGW9XHRO199BRBLRTV	Leila Bello	both who loves Redis, GraphQL, Node.js. Active in the Stellar ecosystem since 2021.	{Redis,GraphQL,Node.js}	[]	\N	both	11	13047.9405980	3.70	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	289	12	{}	[]	\N	t	\N	\N	f	\N
G03VKXTUFDJKDFR21520RN6HW1HS57TCOZDANTNIQSUHA51LIY8O69WE	Chen Osei	both focused on Stellar SDK, Data Engineering. passionate about decentralised finance and open source.	{"Stellar SDK","Data Engineering"}	[]	\N	both	2	6543.2939327	3.79	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	235	2	{}	[]	\N	t	\N	\N	f	\N
GUK3XF1GP1Z7FZTVOVKE6H76MWWJPGJQMLJEL532UUJ2E42TRDW6ET32	Priya Ndegwa	freelancer who loves PostgreSQL, Machine Learning, Terraform. Active in the Stellar ecosystem since 2021.	{PostgreSQL,"Machine Learning",Terraform,Redis,Go,Solidity}	[]	\N	freelancer	23	12475.4494749	3.08	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	39	20	{}	[]	\N	t	\N	\N	f	\N
GMU46JD2GVF6LCP2277KXXSY0VDVEVG9YSQJVFJWTZIFT9YVI7F16XBX	Chen Ruiz	both who loves PostgreSQL, GraphQL, GCP. Active in the Stellar ecosystem since 2021.	{PostgreSQL,GraphQL,GCP,AWS,"Data Engineering",Soroban}	[]	\N	both	13	5125.9851770	3.62	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	392	15	{}	[]	\N	t	\N	\N	f	\N
G87CVIYJKLK2C0XP2S2O8PT4MX23SY670KMIQD4X9G7HSFKR26J1FO2W	Fatima Hassan	Experienced client specialising in Stellar SDK, Go, React Native. Built 37+ projects on Stellar.	{"Stellar SDK",Go,"React Native"}	[]	\N	client	0	0.0000000	\N	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	476	0	{}	[]	\N	t	\N	\N	f	\N
GGVJICS4I42AFBQNJ971HSPTHDP03EH58B6PJS1AWP0LF7XE78669BY4	Tariq Nakamura	Experienced freelancer specialising in Kubernetes, Node.js, PostgreSQL. Built 25+ projects on Stellar.	{Kubernetes,Node.js,PostgreSQL,"Stellar SDK","React Native",Flutter}	[]	\N	freelancer	24	14715.5913383	3.09	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	129	0	{}	[]	\N	t	\N	\N	f	\N
GVICW8VL34LIE3CSMCMCUT6Z84QCMSWDVRHX1Z2YVL55X7RF1F1L8SUG	Kofi Silva	Experienced freelancer specialising in Data Engineering, CI/CD, Terraform. Built 42+ projects on Stellar.	{"Data Engineering",CI/CD,Terraform}	[]	\N	freelancer	18	4597.4378414	3.16	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	308	13	{}	[]	\N	t	\N	\N	f	\N
GDEZX6KBJ2CIEPXXYCJ2XX2EI7XZURPHBL57Y9HQQ2NS5MHIE2L2FUWE	Yuki Andersen	freelancer who loves Soroban, Data Engineering, React Native. Active in the Stellar ecosystem since 2021.	{Soroban,"Data Engineering","React Native",Kubernetes,Azure}	[]	\N	freelancer	18	13369.9752353	4.10	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	435	5	{}	[]	\N	t	\N	\N	f	\N
G9X39IFETZ4700EIUE237WI9LI16DH7JTKKUOW7SFQM9RIT8F6KJKVCB	Ines Kim	Experienced freelancer specialising in Node.js, Solidity, TypeScript. Built 28+ projects on Stellar.	{Node.js,Solidity,TypeScript,React,"React Native","Tailwind CSS"}	[]	\N	freelancer	36	3969.8386175	3.16	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	107	18	{}	[]	\N	t	\N	\N	f	\N
GT4PZT3EDK2043NVJUUWZIX69GUP3HR2PJGDSY0PKUUMK5635T5BFZ63	Tariq Ruiz	Freelance both with strong background in Tailwind CSS, Terraform. Delivered 46+ successful jobs.	{"Tailwind CSS",Terraform}	[]	\N	both	13	8750.1616798	4.93	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	24	1	{}	[]	\N	t	\N	\N	f	\N
GQXZXCZD9MX9SEY629RHIGZXV9XJM6Z6CCCIV473J6IUUKZTV6685T4B	Lars Kone	both who loves Go, AWS, Rust. Active in the Stellar ecosystem since 2021.	{Go,AWS,Rust,"React Native",Solidity}	[]	\N	both	7	14698.4704677	3.74	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	298	9	{}	[]	\N	t	\N	\N	f	\N
G4K7YJPCHMB2U0J0N064DI7N9U47YUL38V8WQ4MPR9TOTSN5U4W9RSH8	Dev Mensah	both focused on Python, Terraform, Android. passionate about decentralised finance and open source.	{Python,Terraform,Android,iOS,GCP}	[]	\N	both	25	12275.6619020	3.76	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	488	4	{}	[]	\N	t	\N	\N	f	\N
GNM8R9RIGPPD7OODG0V4GIA9K044MSUSDFO8CL0LCZ5LSCATGVS3875I	Lars Nakamura	Freelance freelancer with strong background in Kubernetes, GraphQL. Delivered 35+ successful jobs.	{Kubernetes,GraphQL}	[]	\N	freelancer	29	4092.5562225	4.70	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	414	3	{}	[]	\N	t	\N	\N	f	\N
GMLZ16UFZGLI4UPAQYP2RVTAQXPDH3TKZ6THSXOOI4J3X0948NPF727X	Priya Kim	Freelance both with strong background in Terraform, Python, Machine Learning. Delivered 23+ successful jobs.	{Terraform,Python,"Machine Learning",Next.js,Rust}	[]	\N	both	36	1683.1318731	3.16	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	424	17	{}	[]	\N	t	\N	\N	f	\N
G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	Zara Rivera	both focused on React, Next.js, Docker. passionate about decentralised finance and open source.	{React,Next.js,Docker,Figma,GraphQL,Solidity}	[]	\N	both	24	12350.4065606	3.85	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	126	14	{}	[]	\N	t	\N	\N	f	\N
G0BPNEGC2DPCZ2O8NDI6SOUUPTJ7O0TRD9L195DWY7U00JTYL84POTJ3	Kofi Osei	Experienced freelancer specialising in Data Engineering, iOS, Solidity. Built 47+ projects on Stellar.	{"Data Engineering",iOS,Solidity}	[]	\N	freelancer	35	6190.1623347	4.83	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	213	17	{}	[]	\N	t	\N	\N	f	\N
GXF8MDRYCEM9N4NVTANMH4PNZP9USY38WTQX653G4UNXU0COJBQ90SJM	Zara Osei	Experienced freelancer specialising in Python, TypeScript, Docker. Built 33+ projects on Stellar.	{Python,TypeScript,Docker}	[]	\N	freelancer	24	8546.8426906	3.66	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	125	15	{}	[]	\N	t	\N	\N	f	\N
GI85L8D7CEDA0IOEJAN63XD45BA890AB7R8SB61LGG7JPM7QWRZFXZ3P	Hiro Adeyemi	Freelance freelancer with strong background in Data Engineering, Terraform, Tailwind CSS. Delivered 15+ successful jobs.	{"Data Engineering",Terraform,"Tailwind CSS",GraphQL,Next.js}	[]	\N	freelancer	14	4499.6196051	4.98	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	423	2	{}	[]	\N	t	\N	\N	f	\N
GKF51VG7CON4RCER8CLUBNJZETKPY8VYIF6WDG1OEVZUBR25OW9Y1LYF	Leila Nakamura	Experienced client specialising in PostgreSQL, AWS, Tailwind CSS. Built 49+ projects on Stellar.	{PostgreSQL,AWS,"Tailwind CSS",Soroban,Terraform}	[]	\N	client	0	0.0000000	\N	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	395	19	{}	[]	\N	t	\N	\N	f	\N
GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	Lars Hassan	both focused on Stellar SDK, Python. passionate about decentralised finance and open source.	{"Stellar SDK",Python}	[]	\N	both	15	10813.4917868	3.50	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	253	19	{}	[]	\N	t	\N	\N	f	\N
GVYV2V1ITUM4ULZUS5PUYRZXHM8L9B3N2SE05ITPQJ1YE24Z8608CX8F	Rafael Rivera	Experienced freelancer specialising in React, Go. Built 30+ projects on Stellar.	{React,Go}	[]	\N	freelancer	15	9864.0246687	3.22	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	181	5	{}	[]	\N	t	\N	\N	f	\N
GGQO679O2XZ36JWB4GS0FHJWTV3N74W4G22UETCHBVGKP7L9KV913OZL	Leila Ruiz	Experienced client specialising in Terraform, CI/CD, React Native. Built 5+ projects on Stellar.	{Terraform,CI/CD,"React Native",PostgreSQL,Docker,Redis}	[]	\N	client	0	0.0000000	\N	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	95	20	{}	[]	\N	t	\N	\N	f	\N
G1YANNREG8LXUM3HQ57UYZHWW3LTFIUHPTHLXJ6Y0IY1L58L9K5SILU2	Kai Singh	freelancer focused on Data Engineering, Azure. passionate about decentralised finance and open source.	{"Data Engineering",Azure}	[]	\N	freelancer	22	14277.6292573	4.24	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	248	4	{}	[]	\N	t	\N	\N	f	\N
GKFBOSCRO8SK3596HHR8X8C28N1GPTC2QWF2HPNW1KINNDW8R8KUSSR6	Fatima Reyes	both who loves Terraform, Tailwind CSS, Redis. Active in the Stellar ecosystem since 2021.	{Terraform,"Tailwind CSS",Redis,CI/CD,Flutter,Android}	[]	\N	both	6	2033.8335964	4.97	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	384	13	{}	[]	\N	t	\N	\N	f	\N
GUPZ5JR0Y2EFZ6RX35UAF3WE8ZN1N5RUSV9I5VDCG3BHK23A1MITKRFX	Kwame Johansson	both focused on Machine Learning, React Native, React. passionate about decentralised finance and open source.	{"Machine Learning","React Native",React}	[]	\N	both	23	9967.6321712	3.50	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	332	5	{}	[]	\N	t	\N	\N	f	\N
GFGAN4EIO72AAVH1I4EOYFGGUXTIYIJE7AK2WNJ02NFGIHYW1UIPRFP9	Kwame Reyes	both who loves Data Engineering, Machine Learning, iOS. Active in the Stellar ecosystem since 2021.	{"Data Engineering","Machine Learning",iOS,Node.js}	[]	\N	both	38	4273.8121501	4.20	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	481	0	{}	[]	\N	t	\N	\N	f	\N
G5YHP5E7AXUIY0X8L4EBEAQNCDZ6S601ZF88JRFTF6NJ8UZET1PDPF1H	Kai Ivanova	Experienced client specialising in Azure, Figma, TypeScript. Built 20+ projects on Stellar.	{Azure,Figma,TypeScript,"Data Engineering",PostgreSQL,Go}	[]	\N	client	0	0.0000000	\N	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	232	19	{}	[]	\N	t	\N	\N	f	\N
GAK5W77QKXIRHBV1R7EQE536XD5KXKQGHO6ACAPC4XYJLC90OUP0UREX	Rafael Nakamura	freelancer focused on Solidity, Rust, Machine Learning. passionate about decentralised finance and open source.	{Solidity,Rust,"Machine Learning"}	[]	\N	freelancer	3	2690.1652541	3.24	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	411	16	{}	[]	\N	t	\N	\N	f	\N
GXMSTP3X5M8PJA0BO8WAVAYTGN7P05DJRFCO70X3FG6IZED1IPSQUZUU	Kwame Reyes	client who loves React Native, Go, iOS. Active in the Stellar ecosystem since 2021.	{"React Native",Go,iOS,Docker,"Stellar SDK"}	[]	\N	client	0	0.0000000	\N	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	231	8	{}	[]	\N	t	\N	\N	f	\N
GK23U0H8WN2T3QHFKTCNUJFPWZ6DTQLBZ299PG3GIHADOIMZXFQEBEM2	Diego Silva	client focused on iOS, GCP, Solidity. passionate about decentralised finance and open source.	{iOS,GCP,Solidity}	[]	\N	client	0	0.0000000	\N	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	414	4	{}	[]	\N	t	\N	\N	f	\N
G1Z5BY1LWNLRR2JCPS5094DFRYI0M7P8BYW485W6UYRLBUOBRD47WOKG	Chen Adeyemi	client focused on GraphQL, Soroban. passionate about decentralised finance and open source.	{GraphQL,Soroban}	[]	\N	client	0	0.0000000	\N	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	126	7	{}	[]	\N	t	\N	\N	f	\N
GLLPUWBWJM58TL5CFDOOB74AVMIVLUDBJJH7XEXZGVTUIK15UL9WOLYT	Amara Bello	both who loves iOS, Node.js. Active in the Stellar ecosystem since 2021.	{iOS,Node.js}	[]	\N	both	18	1910.2254709	4.47	2026-08-26 20:13:13.799226+00	2026-08-26 20:13:13.799226+00	373	0	{}	[]	\N	t	\N	\N	f	\N
\.


--
-- Data for Name: api_keys; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.api_keys (id, owner_public_key, label, key_prefix, key_hash, last_used_at, revoked_at, created_at) FROM stdin;
\.


--
-- Data for Name: api_key_usage_daily; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.api_key_usage_daily (api_key_id, usage_date, request_count, updated_at) FROM stdin;
\.


--
-- Data for Name: jobs; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.jobs (id, title, description, budget, currency, category, skills, status, client_address, freelancer_address, escrow_contract_id, applicant_count, deadline, timezone, screening_questions, milestones, dispute_reason, dispute_description, disputed_by, disputed_at, created_at, updated_at, expires_at, extended_count, extended_until, view_count, share_count, boosted, boosted_until, visibility, job_search_vector) FROM stdin;
9a4bcb03-e3d7-4f0d-873e-74b09d248097	Design a responsive UI for a decentralised job board	Looking for a skilled smart contracts professional. Skills required: Azure, Docker, Android.	4839.2818438	XLM	Smart Contracts	{Azure,Docker,Android}	completed	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	GQK2919AHEJ8CX9J1ICTXCWNPGW90JPKL0BLV0PRKGYC4OM3WTOOBMZV	\N	1	\N	\N	{}	[]	\N	\N	\N	\N	2026-06-23 20:13:13.760729+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	public	'a':2A,6A,12B 'android':21B,24C 'azure':19B,22C 'board':9A 'contracts':15B 'decentralised':7A 'design':1A 'docker':20B,23C 'for':5A,11B 'job':8A 'looking':10B 'professional':16B 'required':18B 'responsive':3A 'skilled':13B 'skills':17B 'smart':14B 'ui':4A
47dfd2a5-c4f1-4e70-adbe-d8577df19b91	Develop a Next.js marketplace frontend with wallet connect	Looking for a skilled web development professional. Skills required: Kubernetes, Docker, Next.js.	3199.1245127	XLM	Web Development	{Kubernetes,Docker,Next.js}	open	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	\N	\N	1	\N	\N	{}	[]	\N	\N	\N	\N	2026-06-29 20:13:13.76076+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	public	'a':2A,11B 'connect':8A 'develop':1A 'development':14B 'docker':19B,22C 'for':10B 'frontend':5A 'kubernetes':18B,21C 'looking':9B 'marketplace':4A 'next.js':3A,20B,23C 'professional':15B 'required':17B 'skilled':12B 'skills':16B 'wallet':7A 'web':13B 'with':6A
9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	Develop a Next.js marketplace frontend with wallet connect	Looking for a skilled ui/ux design professional. Skills required: Machine Learning, Stellar SDK, Kubernetes.	1320.4568106	XLM	UI/UX Design	{"Machine Learning","Stellar SDK",Kubernetes}	open	G1CBFNO6B9M80O2RAK1VRJNVGFYGWWQC38HYF9SXMECOSFOGYR3XKXWN	\N	\N	6	\N	\N	{}	[]	\N	\N	\N	\N	2026-08-19 20:13:13.760771+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	public	'a':2A,11B 'connect':8A 'design':14B 'develop':1A 'for':10B 'frontend':5A 'kubernetes':22B,27C 'learning':19B,24C 'looking':9B 'machine':18B,23C 'marketplace':4A 'next.js':3A 'professional':15B 'required':17B 'sdk':21B,26C 'skilled':12B 'skills':16B 'stellar':20B,25C 'ui/ux':13B 'wallet':7A 'with':6A
d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	Set up Kubernetes blue-green deployment for Node.js API	Looking for a skilled blockchain development professional. Skills required: Redis, Tailwind CSS, PostgreSQL.	1788.5942880	XLM	Blockchain Development	{Redis,"Tailwind CSS",PostgreSQL}	in_progress	GKF51VG7CON4RCER8CLUBNJZETKPY8VYIF6WDG1OEVZUBR25OW9Y1LYF	GQ3TMY4GPYWSSBZRAD5SOWOMQIGCT2CXIFSU0LMI8X76RKQ4SVH3EJOZ	\N	6	\N	\N	{}	[]	\N	\N	\N	\N	2026-06-25 20:13:13.760779+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	public	'a':13B 'api':10A 'blockchain':15B 'blue':5A 'blue-green':4A 'css':22B,26C 'deployment':7A 'development':16B 'for':8A,12B 'green':6A 'kubernetes':3A 'looking':11B 'node.js':9A 'postgresql':23B,27C 'professional':17B 'redis':20B,24C 'required':19B 'set':1A 'skilled':14B 'skills':18B 'tailwind':21B,25C 'up':2A
a2b96648-2ef9-4f5e-a313-346b9f8db3ab	Build a Soroban escrow contract for freelance payments	Looking for a skilled security auditing professional. Skills required: Android, React Native.	215.3932933	XLM	Security Auditing	{Android,"React Native"}	open	GJARJI8QLHBIAWPUBLQDI07HE42X6G26OC7T3BD4Z1G52EFUJEIR9UY7	\N	\N	3	\N	\N	{}	[]	\N	\N	\N	\N	2026-07-23 20:13:13.760786+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	public	'a':2A,11B 'android':18B,21C 'auditing':14B 'build':1A 'contract':5A 'escrow':4A 'for':6A,10B 'freelance':7A 'looking':9B 'native':20B,23C 'payments':8A 'professional':15B 'react':19B,22C 'required':17B 'security':13B 'skilled':12B 'skills':16B 'soroban':3A
db8441d7-dcfe-4221-b09a-99e5242110e0	Write end-to-end Playwright tests for checkout flow	Looking for a skilled data science professional. Skills required: PostgreSQL, Next.js, Data Engineering.	421.2619842	XLM	Data Science	{PostgreSQL,Next.js,"Data Engineering"}	open	GHKTGBTYZMEPGTHCW81XE6VA05G1X3J1L7R8431RUPFR2P3YVB5UL5NW	\N	\N	3	\N	\N	{}	[]	\N	\N	\N	\N	2026-07-13 20:13:13.760792+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	public	'a':13B 'checkout':9A 'data':15B,22B,26C 'end':3A,5A 'end-to-end':2A 'engineering':23B,27C 'flow':10A 'for':8A,12B 'looking':11B 'next.js':21B,25C 'playwright':6A 'postgresql':20B,24C 'professional':17B 'required':19B 'science':16B 'skilled':14B 'skills':18B 'tests':7A 'to':4A 'write':1A
4c8bd166-dffc-4575-9c78-70031530c30e	Design a responsive UI for a decentralised job board	Looking for a skilled smart contracts professional. Skills required: Terraform, Next.js, Azure, Redis, Soroban.	551.2261643	XLM	Smart Contracts	{Terraform,Next.js,Azure,Redis,Soroban}	cancelled	G5YHP5E7AXUIY0X8L4EBEAQNCDZ6S601ZF88JRFTF6NJ8UZET1PDPF1H	\N	\N	0	\N	\N	{}	[]	\N	\N	\N	\N	2026-07-04 20:13:13.7608+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	public	'a':2A,6A,12B 'azure':21B,26C 'board':9A 'contracts':15B 'decentralised':7A 'design':1A 'for':5A,11B 'job':8A 'looking':10B 'next.js':20B,25C 'professional':16B 'redis':22B,27C 'required':18B 'responsive':3A 'skilled':13B 'skills':17B 'smart':14B 'soroban':23B,28C 'terraform':19B,24C 'ui':4A
27efcb05-6c80-4111-b603-f64c46caaaf1	Design an admin dashboard for dispute resolution	Looking for a skilled devops professional. Skills required: Node.js, Solidity, Soroban, PostgreSQL.	2880.2605489	XLM	DevOps	{Node.js,Solidity,Soroban,PostgreSQL}	open	GLLPUWBWJM58TL5CFDOOB74AVMIVLUDBJJH7XEXZGVTUIK15UL9WOLYT	\N	\N	5	\N	\N	{}	[]	\N	\N	\N	\N	2026-08-06 20:13:13.760807+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	invite_only	'a':10B 'admin':3A 'an':2A 'dashboard':4A 'design':1A 'devops':12B 'dispute':6A 'for':5A,9B 'looking':8B 'node.js':16B,20C 'postgresql':19B,23C 'professional':13B 'required':15B 'resolution':7A 'skilled':11B 'skills':14B 'solidity':17B,21C 'soroban':18B,22C
d9d1a321-9802-4515-ab3b-0d82a7c33e12	Design a responsive UI for a decentralised job board	Looking for a skilled smart contracts professional. Skills required: Stellar SDK, Go, Flutter, CI/CD, Terraform.	3021.0668637	XLM	Smart Contracts	{"Stellar SDK",Go,Flutter,CI/CD,Terraform}	open	G103DGDZVGPMM82I1LR3PE29GD8AFPK054NZDKYAYQ3S195JMSND8DUD	\N	\N	2	\N	\N	{}	[]	\N	\N	\N	\N	2026-08-22 20:13:13.760814+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	public	'a':2A,6A,12B 'board':9A 'ci/cd':23B,29C 'contracts':15B 'decentralised':7A 'design':1A 'flutter':22B,28C 'for':5A,11B 'go':21B,27C 'job':8A 'looking':10B 'professional':16B 'required':18B 'responsive':3A 'sdk':20B,26C 'skilled':13B 'skills':17B 'smart':14B 'stellar':19B,25C 'terraform':24B,30C 'ui':4A
fad32b56-3761-41ba-b671-964232d2cade	Create a CDN invalidation microservice	Looking for a skilled devops professional. Skills required: Tailwind CSS, React Native.	621.7691725	XLM	DevOps	{"Tailwind CSS","React Native"}	open	GYXGO4B9UOE3T0HICCT5HGP8IY3X80J0G50RCXN22PXGX8WDZRMH3FNB	\N	\N	0	\N	\N	{}	[]	\N	\N	\N	\N	2026-06-26 20:13:13.76082+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	invite_only	'a':2A,8B 'cdn':3A 'create':1A 'css':15B,19C 'devops':10B 'for':7B 'invalidation':4A 'looking':6B 'microservice':5A 'native':17B,21C 'professional':11B 'react':16B,20C 'required':13B 'skilled':9B 'skills':12B 'tailwind':14B,18C
542fd826-c128-494a-ae70-d8d0ff8ab92f	Create a Rust service that indexes Horizon API events	Looking for a skilled devops professional. Skills required: Terraform, AWS.	1968.2592293	XLM	DevOps	{Terraform,AWS}	cancelled	GXMSTP3X5M8PJA0BO8WAVAYTGN7P05DJRFCO70X3FG6IZED1IPSQUZUU	\N	\N	0	\N	\N	{}	[]	\N	\N	\N	\N	2026-07-09 20:13:13.760825+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	invite_only	'a':2A,12B 'api':8A 'aws':19B,21C 'create':1A 'devops':14B 'events':9A 'for':11B 'horizon':7A 'indexes':6A 'looking':10B 'professional':15B 'required':17B 'rust':3A 'service':4A 'skilled':13B 'skills':16B 'terraform':18B,20C 'that':5A
249e0244-7263-4347-9003-c40eeeadb1e9	Build a Soroban escrow contract for freelance payments	Looking for a skilled smart contracts professional. Skills required: GraphQL, Python, Node.js, Flutter.	1379.3818667	XLM	Smart Contracts	{GraphQL,Python,Node.js,Flutter}	in_progress	GG73AJ0JE4QVZFV8YU58CEPSOF1GG2KTBCUDSWX1JP70LKLFYP5JO3Q3	GHKTGBTYZMEPGTHCW81XE6VA05G1X3J1L7R8431RUPFR2P3YVB5UL5NW	\N	3	\N	\N	{}	[]	\N	\N	\N	\N	2026-05-28 20:13:13.760832+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	public	'a':2A,11B 'build':1A 'contract':5A 'contracts':14B 'escrow':4A 'flutter':21B,25C 'for':6A,10B 'freelance':7A 'graphql':18B,22C 'looking':9B 'node.js':20B,24C 'payments':8A 'professional':15B 'python':19B,23C 'required':17B 'skilled':12B 'skills':16B 'smart':13B 'soroban':3A
aed25e1a-56d0-41de-95d3-3f87f58211df	Design an admin dashboard for dispute resolution	Looking for a skilled data science professional. Skills required: Redis, iOS, GCP, Node.js, AWS, Soroban.	4211.9459738	XLM	Data Science	{Redis,iOS,GCP,Node.js,AWS,Soroban}	open	GHKTGBTYZMEPGTHCW81XE6VA05G1X3J1L7R8431RUPFR2P3YVB5UL5NW	\N	\N	0	\N	\N	{}	[]	\N	\N	\N	\N	2026-06-18 20:13:13.760841+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	invite_only	'a':10B 'admin':3A 'an':2A 'aws':21B,27C 'dashboard':4A 'data':12B 'design':1A 'dispute':6A 'for':5A,9B 'gcp':19B,25C 'ios':18B,24C 'looking':8B 'node.js':20B,26C 'professional':14B 'redis':17B,23C 'required':16B 'resolution':7A 'science':13B 'skilled':11B 'skills':15B 'soroban':22B,28C
97e76a83-56be-438d-8980-0b021aa4ac82	Migrate a legacy Express API to TypeScript	Looking for a skilled ui/ux design professional. Skills required: Go, Stellar SDK, PostgreSQL, React Native, Machine Learning.	221.9060431	XLM	UI/UX Design	{Go,"Stellar SDK",PostgreSQL,"React Native","Machine Learning"}	completed	G5YHP5E7AXUIY0X8L4EBEAQNCDZ6S601ZF88JRFTF6NJ8UZET1PDPF1H	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	\N	5	\N	\N	{}	[]	\N	\N	\N	\N	2026-08-10 20:13:13.760849+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	public	'a':2A,10B 'api':5A 'design':13B 'express':4A 'for':9B 'go':17B,25C 'learning':24B,32C 'legacy':3A 'looking':8B 'machine':23B,31C 'migrate':1A 'native':22B,30C 'postgresql':20B,28C 'professional':14B 'react':21B,29C 'required':16B 'sdk':19B,27C 'skilled':11B 'skills':15B 'stellar':18B,26C 'to':6A 'typescript':7A 'ui/ux':12B
9d5b219d-7605-4b8e-8a0d-fabadbd58014	Develop a Next.js marketplace frontend with wallet connect	Looking for a skilled mobile development professional. Skills required: Android, TypeScript, React.	261.2457081	XLM	Mobile Development	{Android,TypeScript,React}	open	GUPZ5JR0Y2EFZ6RX35UAF3WE8ZN1N5RUSV9I5VDCG3BHK23A1MITKRFX	\N	\N	2	\N	\N	{}	[]	\N	\N	\N	\N	2026-07-31 20:13:13.760855+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	invite_only	'a':2A,11B 'android':18B,21C 'connect':8A 'develop':1A 'development':14B 'for':10B 'frontend':5A 'looking':9B 'marketplace':4A 'mobile':13B 'next.js':3A 'professional':15B 'react':20B,23C 'required':17B 'skilled':12B 'skills':16B 'typescript':19B,22C 'wallet':7A 'with':6A
57192032-1abb-4169-9d39-bdb57a9b428f	Build a real-time notification service with WebSockets	Looking for a skilled devops professional. Skills required: Data Engineering, Android, Stellar SDK, PostgreSQL.	2804.0028097	XLM	DevOps	{"Data Engineering",Android,"Stellar SDK",PostgreSQL}	completed	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	GLLPUWBWJM58TL5CFDOOB74AVMIVLUDBJJH7XEXZGVTUIK15UL9WOLYT	\N	3	\N	\N	{}	[]	\N	\N	\N	\N	2026-07-21 20:13:13.760863+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	public	'a':2A,12B 'android':20B,26C 'build':1A 'data':18B,24C 'devops':14B 'engineering':19B,25C 'for':11B 'looking':10B 'notification':6A 'postgresql':23B,29C 'professional':15B 'real':4A 'real-time':3A 'required':17B 'sdk':22B,28C 'service':7A 'skilled':13B 'skills':16B 'stellar':21B,27C 'time':5A 'websockets':9A 'with':8A
b58a7d47-2106-4e8c-9051-fdc81013b0c9	Migrate a legacy Express API to TypeScript	Looking for a skilled smart contracts professional. Skills required: GCP, Figma, Android, Redis, Solidity, iOS.	790.7294820	XLM	Smart Contracts	{GCP,Figma,Android,Redis,Solidity,iOS}	in_progress	G1Z5BY1LWNLRR2JCPS5094DFRYI0M7P8BYW485W6UYRLBUOBRD47WOKG	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	\N	6	\N	\N	{}	[]	\N	\N	\N	\N	2026-08-12 20:13:13.760871+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	public	'a':2A,10B 'android':19B,25C 'api':5A 'contracts':13B 'express':4A 'figma':18B,24C 'for':9B 'gcp':17B,23C 'ios':22B,28C 'legacy':3A 'looking':8B 'migrate':1A 'professional':14B 'redis':20B,26C 'required':16B 'skilled':11B 'skills':15B 'smart':12B 'solidity':21B,27C 'to':6A 'typescript':7A
46655f7b-1ae1-417c-be78-44f9e68055d4	Build a Soroban escrow contract for freelance payments	Looking for a skilled data science professional. Skills required: Python, PostgreSQL, Terraform, Tailwind CSS, GCP.	3064.3626522	XLM	Data Science	{Python,PostgreSQL,Terraform,"Tailwind CSS",GCP}	open	GHKTGBTYZMEPGTHCW81XE6VA05G1X3J1L7R8431RUPFR2P3YVB5UL5NW	\N	\N	1	\N	\N	{}	[]	\N	\N	\N	\N	2026-07-21 20:13:13.760878+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	public	'a':2A,11B 'build':1A 'contract':5A 'css':22B,28C 'data':13B 'escrow':4A 'for':6A,10B 'freelance':7A 'gcp':23B,29C 'looking':9B 'payments':8A 'postgresql':19B,25C 'professional':15B 'python':18B,24C 'required':17B 'science':14B 'skilled':12B 'skills':16B 'soroban':3A 'tailwind':21B,27C 'terraform':20B,26C
33900b8b-00fd-429d-8731-00631a2a2e2e	Build a Soroban escrow contract for freelance payments	Looking for a skilled blockchain development professional. Skills required: PostgreSQL, Docker.	3468.0430831	XLM	Blockchain Development	{PostgreSQL,Docker}	open	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	\N	\N	0	\N	\N	{}	[]	\N	\N	\N	\N	2026-07-22 20:13:13.760884+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	invite_only	'a':2A,11B 'blockchain':13B 'build':1A 'contract':5A 'development':14B 'docker':19B,21C 'escrow':4A 'for':6A,10B 'freelance':7A 'looking':9B 'payments':8A 'postgresql':18B,20C 'professional':15B 'required':17B 'skilled':12B 'skills':16B 'soroban':3A
74168a8c-e4aa-4e6a-88b0-a29ae4645e05	Develop a mobile app for Stellar wallet onboarding	Looking for a skilled data science professional. Skills required: Go, Python, Flutter, Tailwind CSS.	4298.2621770	XLM	Data Science	{Go,Python,Flutter,"Tailwind CSS"}	open	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	\N	\N	2	\N	\N	{}	[]	\N	\N	\N	\N	2026-07-27 20:13:13.76089+00	2026-08-26 20:13:13.84278+00	\N	0	\N	0	0	f	\N	public	'a':2A,11B 'app':4A 'css':22B,27C 'data':13B 'develop':1A 'flutter':20B,25C 'for':5A,10B 'go':18B,23C 'looking':9B 'mobile':3A 'onboarding':8A 'professional':15B 'python':19B,24C 'required':17B 'science':14B 'skilled':12B 'skills':16B 'stellar':6A 'tailwind':21B,26C 'wallet':7A
\.


--
-- Data for Name: applications; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.applications (id, job_id, freelancer_address, proposal, bid_amount, status, accepted_at, created_at, referred_by, currency, screening_answers, withdrawn_at) FROM stdin;
b9536c59-7be5-4c85-9260-1271612d989b	9a4bcb03-e3d7-4f0d-873e-74b09d248097	GDEZX6KBJ2CIEPXXYCJ2XX2EI7XZURPHBL57Y9HQQ2NS5MHIE2L2FUWE	Hi there! I am a freelancer with deep expertise in Python, Data Engineering. I would approach this by breaking it into milestones and delivering incrementally.	4324.7037941	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
76378730-978c-4d37-b673-bde9e1a90443	47dfd2a5-c4f1-4e70-adbe-d8577df19b91	GXF8MDRYCEM9N4NVTANMH4PNZP9USY38WTQX653G4UNXU0COJBQ90SJM	Hello! I specialise in Data Engineering, Tailwind CSS and have delivered 19+ jobs in this space. I can start immediately.	3071.6608067	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
914bb0bd-e34a-4f70-9d00-69b4f6eb8b4a	9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	GQK2919AHEJ8CX9J1ICTXCWNPGW90JPKL0BLV0PRKGYC4OM3WTOOBMZV	Hi there! I am a freelancer with deep expertise in iOS, React Native. I would approach this by breaking it into milestones and delivering incrementally.	1272.6559801	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
870abdd0-5cf5-449d-93ae-e4177adeabe7	9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	G1YANNREG8LXUM3HQ57UYZHWW3LTFIUHPTHLXJ6Y0IY1L58L9K5SILU2	Hi, I have 4 years of experience with TypeScript, Flutter and would love to help. I recently completed a similar project on Stellar testnet.	1255.8772337	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
2f64acdd-6ad9-4eaf-b48e-2e6a5954ff6a	9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	GQ3TMY4GPYWSSBZRAD5SOWOMQIGCT2CXIFSU0LMI8X76RKQ4SVH3EJOZ	Hello! I specialise in GraphQL, Soroban and have delivered 14+ jobs in this space. I can start immediately.	1203.4513750	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
785ad221-513a-4449-8cf9-f2d3ba7186f6	9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	GG1WU16HYMQC1A78MX1EVUHT6T0UZS9IM0YLTZ9ATSN1U322N64KFS6V	Greetings! My background in Flutter, GraphQL aligns well with this job. I have a portfolio of 19+ on-chain projects.	1081.5633075	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
8ab070f5-94d0-46f6-8b59-192d4a75a6aa	9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	GDEZX6KBJ2CIEPXXYCJ2XX2EI7XZURPHBL57Y9HQQ2NS5MHIE2L2FUWE	Hi, I have 2 years of experience with Node.js, Kubernetes and would love to help. I recently completed a similar project on Stellar testnet.	1159.6424401	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
3fd2ab9a-dc7a-4c00-be03-110c4cb608b2	9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	GAK5W77QKXIRHBV1R7EQE536XD5KXKQGHO6ACAPC4XYJLC90OUP0UREX	Hello! I specialise in GCP, AWS and have delivered 14+ jobs in this space. I can start immediately.	1060.6895499	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
2893cb87-168d-4d54-a044-1714a41185b8	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	GMU46JD2GVF6LCP2277KXXSY0VDVEVG9YSQJVFJWTZIFT9YVI7F16XBX	Hello! I specialise in React Native, Node.js and have delivered 10+ jobs in this space. I can start immediately.	1362.9433599	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
a5e8dae3-74a8-43c7-aa14-d2dfa2604858	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	GY4AWTY088O5OR15BYVZK3I8BZBF1I3LDQYUN3UVYR0QF4B8DWOECBPM	Hi there! I am a freelancer with deep expertise in Rust, React Native. I would approach this by breaking it into milestones and delivering incrementally.	1741.1153934	rejected	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
7937a61b-71f9-472f-ba16-cca11cd75bdc	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	GVICW8VL34LIE3CSMCMCUT6Z84QCMSWDVRHX1Z2YVL55X7RF1F1L8SUG	Hello! I specialise in Node.js, Python and have delivered 12+ jobs in this space. I can start immediately.	1770.9003203	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
a0606f8d-4b22-4745-83ae-6b788f608b6a	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	GXK87AU5BHXTPDPFF5E8II49KQ71N8MTZX272HPOEVB9OOAEDOECVE6P	Greetings! My background in PostgreSQL, React Native aligns well with this job. I have a portfolio of 14+ on-chain projects.	1387.2330372	rejected	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
1d7ec38b-e330-477e-8975-d4c8db079db8	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	GNM8R9RIGPPD7OODG0V4GIA9K044MSUSDFO8CL0LCZ5LSCATGVS3875I	Hi there! I am a freelancer with deep expertise in CI/CD, Figma. I would approach this by breaking it into milestones and delivering incrementally.	1306.9144545	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
44883dcd-eb80-4445-95f9-3bb0a1ca1cac	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	GQK2919AHEJ8CX9J1ICTXCWNPGW90JPKL0BLV0PRKGYC4OM3WTOOBMZV	Greetings! My background in Terraform, Azure aligns well with this job. I have a portfolio of 12+ on-chain projects.	1619.2572292	rejected	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
4c1ca1e2-3a85-4d62-b2e0-750a6fdd13e9	a2b96648-2ef9-4f5e-a313-346b9f8db3ab	GG1WU16HYMQC1A78MX1EVUHT6T0UZS9IM0YLTZ9ATSN1U322N64KFS6V	Greetings! My background in Python, Terraform aligns well with this job. I have a portfolio of 12+ on-chain projects.	162.9467548	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
989cd355-0879-4cc6-bdf4-0045cef7562f	a2b96648-2ef9-4f5e-a313-346b9f8db3ab	GT4PZT3EDK2043NVJUUWZIX69GUP3HR2PJGDSY0PKUUMK5635T5BFZ63	Hello! I specialise in Android, React Native and have delivered 15+ jobs in this space. I can start immediately.	193.4574458	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
7e6b5027-69c8-4292-ba44-d89ad0e2b0c7	a2b96648-2ef9-4f5e-a313-346b9f8db3ab	GGVJICS4I42AFBQNJ971HSPTHDP03EH58B6PJS1AWP0LF7XE78669BY4	Hello! I specialise in Terraform, Tailwind CSS and have delivered 12+ jobs in this space. I can start immediately.	167.5389091	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
2e39ae87-5ad6-496a-b978-bd48adcb430b	db8441d7-dcfe-4221-b09a-99e5242110e0	GMLZ16UFZGLI4UPAQYP2RVTAQXPDH3TKZ6THSXOOI4J3X0948NPF727X	Hello! I specialise in Data Engineering, Machine Learning and have delivered 10+ jobs in this space. I can start immediately.	381.6193077	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
c42c645c-43f8-4aa8-98e4-844436fcede5	db8441d7-dcfe-4221-b09a-99e5242110e0	GNM8R9RIGPPD7OODG0V4GIA9K044MSUSDFO8CL0LCZ5LSCATGVS3875I	Hi there! I am a freelancer with deep expertise in Figma, Go. I would approach this by breaking it into milestones and delivering incrementally.	401.1221263	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
62ada45a-b33a-4b90-b8da-b6772586c600	db8441d7-dcfe-4221-b09a-99e5242110e0	GEPZHPCF07UQNUPQZIT3UEA3GE8N6QIWEPXSK28T7A9TGIQHG9JRSNVN	Hello! I specialise in Solidity, Tailwind CSS and have delivered 7+ jobs in this space. I can start immediately.	388.5196777	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
821c0c50-786b-4859-bcc4-b9f7fcbba083	27efcb05-6c80-4111-b603-f64c46caaaf1	GFGAN4EIO72AAVH1I4EOYFGGUXTIYIJE7AK2WNJ02NFGIHYW1UIPRFP9	Greetings! My background in Data Engineering, React Native aligns well with this job. I have a portfolio of 12+ on-chain projects.	2379.5035492	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
e2ee49a3-af62-4e92-81eb-8293273c49db	27efcb05-6c80-4111-b603-f64c46caaaf1	GYXGO4B9UOE3T0HICCT5HGP8IY3X80J0G50RCXN22PXGX8WDZRMH3FNB	Greetings! My background in Python, GCP aligns well with this job. I have a portfolio of 12+ on-chain projects.	2416.9078167	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
1035bb6f-a522-45c8-acfb-1dda5ada9e7b	27efcb05-6c80-4111-b603-f64c46caaaf1	GT4PZT3EDK2043NVJUUWZIX69GUP3HR2PJGDSY0PKUUMK5635T5BFZ63	Hi, I have 9 years of experience with Soroban, React Native and would love to help. I recently completed a similar project on Stellar testnet.	2424.2171007	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
413b20c9-83f3-407b-8d3a-5bd24238e1b4	27efcb05-6c80-4111-b603-f64c46caaaf1	GY4AWTY088O5OR15BYVZK3I8BZBF1I3LDQYUN3UVYR0QF4B8DWOECBPM	Hello! I specialise in Solidity, React Native and have delivered 15+ jobs in this space. I can start immediately.	2474.0042669	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
01410175-162d-41ad-8c3c-90681c42d170	27efcb05-6c80-4111-b603-f64c46caaaf1	G03VKXTUFDJKDFR21520RN6HW1HS57TCOZDANTNIQSUHA51LIY8O69WE	Hi there! I am a both with deep expertise in React Native, React. I would approach this by breaking it into milestones and delivering incrementally.	2873.6484957	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
d11f63b0-8cd2-4a61-b054-af8ebd1bd11e	d9d1a321-9802-4515-ab3b-0d82a7c33e12	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	Hi there! I am a both with deep expertise in Docker, React Native. I would approach this by breaking it into milestones and delivering incrementally.	2820.7168186	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
bc9757c2-a8da-4a7a-aecd-3079752326e6	d9d1a321-9802-4515-ab3b-0d82a7c33e12	GAK5W77QKXIRHBV1R7EQE536XD5KXKQGHO6ACAPC4XYJLC90OUP0UREX	Hi there! I am a freelancer with deep expertise in Terraform, Next.js. I would approach this by breaking it into milestones and delivering incrementally.	2689.8059478	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
a8e483db-f5d4-49a8-8284-2932c3cc614c	249e0244-7263-4347-9003-c40eeeadb1e9	GGVJICS4I42AFBQNJ971HSPTHDP03EH58B6PJS1AWP0LF7XE78669BY4	Hello! I specialise in Android, iOS and have delivered 5+ jobs in this space. I can start immediately.	1219.8479694	accepted	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
4321fc2a-5f7e-4ce1-a7b6-8b0abaa80970	249e0244-7263-4347-9003-c40eeeadb1e9	G3Z0GU1UQXJ4EFFF1GXI9D99VH0W1DSTWG6NJ4OGW9XHRO199BRBLRTV	Hi there! I am a both with deep expertise in Redis, Tailwind CSS. I would approach this by breaking it into milestones and delivering incrementally.	981.1785928	accepted	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
93a4077e-023e-4cfe-aae0-f611b3b78cbc	249e0244-7263-4347-9003-c40eeeadb1e9	GQ3TMY4GPYWSSBZRAD5SOWOMQIGCT2CXIFSU0LMI8X76RKQ4SVH3EJOZ	Hello! I specialise in Rust, Docker and have delivered 19+ jobs in this space. I can start immediately.	972.9812603	accepted	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
67c3ba72-9ecc-44d3-8cbb-4014cb6f21fc	97e76a83-56be-438d-8980-0b021aa4ac82	GUK3XF1GP1Z7FZTVOVKE6H76MWWJPGJQMLJEL532UUJ2E42TRDW6ET32	Hi, I have 8 years of experience with Figma, GCP and would love to help. I recently completed a similar project on Stellar testnet.	159.6805056	accepted	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
7329131d-3887-4c68-8865-bf073e069ec7	97e76a83-56be-438d-8980-0b021aa4ac82	G03VKXTUFDJKDFR21520RN6HW1HS57TCOZDANTNIQSUHA51LIY8O69WE	Hi, I have 6 years of experience with Go, GraphQL and would love to help. I recently completed a similar project on Stellar testnet.	190.2256919	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
537549f1-9366-46a4-b954-8c992bbccd61	97e76a83-56be-438d-8980-0b021aa4ac82	GQXZXCZD9MX9SEY629RHIGZXV9XJM6Z6CCCIV473J6IUUKZTV6685T4B	Hi there! I am a both with deep expertise in Docker, Tailwind CSS. I would approach this by breaking it into milestones and delivering incrementally.	166.3108243	accepted	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
65a22f3c-26df-40e1-a11e-75e45f0a786a	97e76a83-56be-438d-8980-0b021aa4ac82	GDEZX6KBJ2CIEPXXYCJ2XX2EI7XZURPHBL57Y9HQQ2NS5MHIE2L2FUWE	Hi there! I am a freelancer with deep expertise in Node.js, Data Engineering. I would approach this by breaking it into milestones and delivering incrementally.	204.2030415	accepted	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
72156fed-6bd4-43b0-beae-b53ce10d4777	97e76a83-56be-438d-8980-0b021aa4ac82	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	Hello! I specialise in Kubernetes, Machine Learning and have delivered 4+ jobs in this space. I can start immediately.	213.6873625	rejected	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
69062675-803d-4349-b913-961abbe8f554	9d5b219d-7605-4b8e-8a0d-fabadbd58014	GUPZ5JR0Y2EFZ6RX35UAF3WE8ZN1N5RUSV9I5VDCG3BHK23A1MITKRFX	Hi, I have 3 years of experience with Terraform, Flutter and would love to help. I recently completed a similar project on Stellar testnet.	186.6523561	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
96f594e2-0efc-41b4-9550-477c68e9a917	9d5b219d-7605-4b8e-8a0d-fabadbd58014	GQK2919AHEJ8CX9J1ICTXCWNPGW90JPKL0BLV0PRKGYC4OM3WTOOBMZV	Hi, I have 8 years of experience with GraphQL, PostgreSQL and would love to help. I recently completed a similar project on Stellar testnet.	225.7645479	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
c04751f0-ff4e-4118-900c-25e21355908c	57192032-1abb-4169-9d39-bdb57a9b428f	GKT9A90FOH3HJ5S6R044P39JYM6IER0V6RAST5J284WV98Y3UMPYO0CU	Greetings! My background in CI/CD, Solidity aligns well with this job. I have a portfolio of 19+ on-chain projects.	2486.6999816	rejected	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
5b04a873-3305-4369-abee-cb2ebea09b61	57192032-1abb-4169-9d39-bdb57a9b428f	G3Z0GU1UQXJ4EFFF1GXI9D99VH0W1DSTWG6NJ4OGW9XHRO199BRBLRTV	Hello! I specialise in Flutter, Solidity and have delivered 19+ jobs in this space. I can start immediately.	2482.4100072	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
1ef512a2-87e9-4c82-86b3-dd266f55fd95	57192032-1abb-4169-9d39-bdb57a9b428f	GYR9OUDOCUZRENUN5Z3JQIP98Q1ZXOI65FDHJK1EYY37Q9AH8RVHS1K3	Greetings! My background in Android, Solidity aligns well with this job. I have a portfolio of 18+ on-chain projects.	2475.0948022	accepted	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
20b6869f-e488-464c-b333-90990981bd9b	b58a7d47-2106-4e8c-9051-fdc81013b0c9	GMU46JD2GVF6LCP2277KXXSY0VDVEVG9YSQJVFJWTZIFT9YVI7F16XBX	Hello! I specialise in AWS, Tailwind CSS and have delivered 9+ jobs in this space. I can start immediately.	774.8653163	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
f028f144-9721-48b3-a2b0-f9535d8ea0e0	b58a7d47-2106-4e8c-9051-fdc81013b0c9	GKFBOSCRO8SK3596HHR8X8C28N1GPTC2QWF2HPNW1KINNDW8R8KUSSR6	Greetings! My background in Rust, CI/CD aligns well with this job. I have a portfolio of 5+ on-chain projects.	751.6434466	accepted	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
50d35564-fcf6-4136-8987-d2677be7ed4e	b58a7d47-2106-4e8c-9051-fdc81013b0c9	GJARJI8QLHBIAWPUBLQDI07HE42X6G26OC7T3BD4Z1G52EFUJEIR9UY7	Hi there! I am a both with deep expertise in Stellar SDK, iOS. I would approach this by breaking it into milestones and delivering incrementally.	725.1535626	accepted	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
551684f7-f7a2-4e78-8b17-d12502440d2c	b58a7d47-2106-4e8c-9051-fdc81013b0c9	GQXZXCZD9MX9SEY629RHIGZXV9XJM6Z6CCCIV473J6IUUKZTV6685T4B	Hi, I have 6 years of experience with Terraform, Node.js and would love to help. I recently completed a similar project on Stellar testnet.	616.1660701	rejected	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
35d50a80-558f-4cab-971d-f60f82545bbb	b58a7d47-2106-4e8c-9051-fdc81013b0c9	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	Hi, I have 3 years of experience with Flutter, Next.js and would love to help. I recently completed a similar project on Stellar testnet.	638.9603438	rejected	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
4d92dcc9-6c1f-4311-954a-977d183ad59b	b58a7d47-2106-4e8c-9051-fdc81013b0c9	GVICW8VL34LIE3CSMCMCUT6Z84QCMSWDVRHX1Z2YVL55X7RF1F1L8SUG	Greetings! My background in Data Engineering, Solidity aligns well with this job. I have a portfolio of 6+ on-chain projects.	555.8050958	accepted	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
645c51da-74da-4574-870b-6b72307250ad	46655f7b-1ae1-417c-be78-44f9e68055d4	GQ3TMY4GPYWSSBZRAD5SOWOMQIGCT2CXIFSU0LMI8X76RKQ4SVH3EJOZ	Greetings! My background in GraphQL, Azure aligns well with this job. I have a portfolio of 11+ on-chain projects.	2952.6441448	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
bbb984dc-8b47-4764-ba38-93a5de42d618	74168a8c-e4aa-4e6a-88b0-a29ae4645e05	GT4PZT3EDK2043NVJUUWZIX69GUP3HR2PJGDSY0PKUUMK5635T5BFZ63	Hi, I have 8 years of experience with PostgreSQL, GraphQL and would love to help. I recently completed a similar project on Stellar testnet.	4086.4115955	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
69148936-a9b4-479b-ada9-d997181f00bd	74168a8c-e4aa-4e6a-88b0-a29ae4645e05	GYXGO4B9UOE3T0HICCT5HGP8IY3X80J0G50RCXN22PXGX8WDZRMH3FNB	Hi there! I am a both with deep expertise in Terraform, Android. I would approach this by breaking it into milestones and delivering incrementally.	3154.5675399	pending	\N	2026-08-26 20:13:13.892014+00	\N	XLM	{}	\N
\.


--
-- Data for Name: assessment_skills; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.assessment_skills (id, slug, label, status, pass_score, duration_seconds, cooldown_days, questions_per_attempt, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: assessment_questions; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.assessment_questions (id, skill_id, question_text, options, correct_option_index, difficulty, tags, status, version, created_by, created_at, updated_at, published_at) FROM stdin;
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.audit_logs (id, actor_address, action, target, reason, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: insured_files; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.insured_files (id, cid, owner_address, file_size, file_value, premium, storage_type, status, availability_score, checks_total, checks_passed, last_checked, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: availability_check_history; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.availability_check_history (id, file_id, cid, is_available, check_duration_ms, error_message, created_at) FROM stdin;
\.


--
-- Data for Name: contract_events; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.contract_events (id, job_id, event_type, contract_id, tx_hash, ledger, data, created_at) FROM stdin;
\.


--
-- Data for Name: dao_arbitrators; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.dao_arbitrators (public_key, display_name, bio, votes_received, disputes_resolved, elected_at, active, created_at) FROM stdin;
\.


--
-- Data for Name: dao_proposals; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.dao_proposals (id, title, description, type, proposer, amount, recipient, status, voting_ends_at, created_at, executed_at) FROM stdin;
\.


--
-- Data for Name: dao_votes; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.dao_votes (id, proposal_id, voter, support, weight, tx_hash, created_at) FROM stdin;
\.


--
-- Data for Name: dispute_evidence; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.dispute_evidence (id, job_id, uploader_address, file_name, file_size, mime_type, ipfs_cid, created_at) FROM stdin;
\.


--
-- Data for Name: escrows; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.escrows (id, job_id, contract_id, amount_xlm, milestones, status, released_at, timeout_at, guardian_address, high_value_threshold, guardian_approved, guardian_approved_at, release_timeout_at, created_at, updated_at, referrer_address) FROM stdin;
a225aaa9-c516-4fd0-8fde-28d14e7fb31c	9a4bcb03-e3d7-4f0d-873e-74b09d248097	C38ca670f33550ed67330228f9d24dc6ce93df4a17e2753a4325c1c2	4839.2818438	[{"due": "2026-09-01", "name": "Milestone 1", "amount": "4839.2818438"}, {"due": "2026-10-01", "name": "Milestone 2", "amount": "2419.6409219"}]	timeout_refunded	2026-08-20 20:13:13.761468+00	\N	\N	\N	f	\N	\N	2026-08-26 20:13:13.938405+00	2026-08-26 20:13:13.938405+00	\N
afba4ef0-12b8-467a-829c-67d9dd20c746	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	C49f206a876126033e1c16b5345c3341a49f8c45aa8c8affe226b591	1788.5942880	[{"due": "2026-09-01", "name": "Milestone 1", "amount": "1788.594288"}, {"due": "2026-10-01", "name": "Milestone 2", "amount": "894.297144"}]	refunded	\N	\N	\N	\N	f	\N	\N	2026-08-26 20:13:13.938405+00	2026-08-26 20:13:13.938405+00	\N
1d03c164-e89c-49e2-adb6-fcb9da250c69	249e0244-7263-4347-9003-c40eeeadb1e9	Cebf69eecae826dab7caa9ea72fa3a52008134a6062e08cbe415cef3	1379.3818667	[{"due": "2026-09-01", "name": "Milestone 1", "amount": "1379.3818667"}, {"due": "2026-10-01", "name": "Milestone 2", "amount": "689.6909334"}]	released	2026-08-01 20:13:13.761494+00	\N	\N	\N	f	\N	\N	2026-08-26 20:13:13.938405+00	2026-08-26 20:13:13.938405+00	\N
bfb76e11-e234-4f4a-9b6f-9bbad3c4bacf	97e76a83-56be-438d-8980-0b021aa4ac82	C5238183500b0e30d5bfed22f98f3548ded16d834e093e7dca8e566f	221.9060431	[{"due": "2026-09-01", "name": "Milestone 1", "amount": "221.9060431"}, {"due": "2026-10-01", "name": "Milestone 2", "amount": "110.9530216"}]	refunded	\N	\N	\N	\N	f	\N	\N	2026-08-26 20:13:13.938405+00	2026-08-26 20:13:13.938405+00	\N
67928678-38b1-49bc-a451-f9a19ad4f9a5	57192032-1abb-4169-9d39-bdb57a9b428f	C9ccff5f36fac5d974c403d96fb0036e8a0df1fadf9a5ecc0d530950	2804.0028097	[{"due": "2026-09-01", "name": "Milestone 1", "amount": "2804.0028097"}, {"due": "2026-10-01", "name": "Milestone 2", "amount": "1402.0014048"}]	funded	\N	2026-10-15 20:13:13.761542+00	\N	\N	f	\N	\N	2026-08-26 20:13:13.938405+00	2026-08-26 20:13:13.938405+00	\N
ce023fea-5b89-4015-944d-3bf8ccdd3b29	b58a7d47-2106-4e8c-9051-fdc81013b0c9	C25e5e6c06ae658dfd105ee0ee2afdcd770b92c520383bece873a80d	790.7294820	[{"due": "2026-09-01", "name": "Milestone 1", "amount": "790.729482"}, {"due": "2026-10-01", "name": "Milestone 2", "amount": "395.364741"}]	refunded	\N	\N	\N	\N	f	\N	\N	2026-08-26 20:13:13.938405+00	2026-08-26 20:13:13.938405+00	\N
\.


--
-- Data for Name: frozen_wallets; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.frozen_wallets (address, reason, frozen_by, created_at) FROM stdin;
\.


--
-- Data for Name: indexer_state; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.indexer_state (id, synced, last_processed_ledger, last_transaction_at, updated_at) FROM stdin;
1	f	\N	\N	2026-08-25 23:29:12.821164+00
\.


--
-- Data for Name: insurance_claims; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.insurance_claims (id, file_id, owner_address, claim_amount, status, evidence, oracle_proof, oracle_address, payout_tx_hash, rejection_reason, created_at, proof_submitted_at, paid_at, updated_at) FROM stdin;
\.


--
-- Data for Name: insurance_premiums_paid; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.insurance_premiums_paid (id, file_id, owner_address, premium_amount, payment_tx_hash, payment_status, created_at, confirmed_at) FROM stdin;
\.


--
-- Data for Name: job_drafts; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.job_drafts (id, client_address, title, description, budget, category, skills, currency, timezone, visibility, screening_questions, deadline, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: job_views; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.job_views (id, job_id, ip_hash, viewed_at) FROM stdin;
\.


--
-- Data for Name: messages; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.messages (id, job_id, sender_address, receiver_address, content, read, created_at) FROM stdin;
2a3e02e1-3f9c-4b23-a05c-c49db2182e89	9a4bcb03-e3d7-4f0d-873e-74b09d248097	GQK2919AHEJ8CX9J1ICTXCWNPGW90JPKL0BLV0PRKGYC4OM3WTOOBMZV	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	Great work! The release transaction was confirmed on Stellar.	t	2026-06-26 01:13:13.760729+00
12a53596-c937-40e3-aa8a-2f7ec56d044c	9a4bcb03-e3d7-4f0d-873e-74b09d248097	GQK2919AHEJ8CX9J1ICTXCWNPGW90JPKL0BLV0PRKGYC4OM3WTOOBMZV	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	Hi, I have a question about the milestones. Could we adjust the second milestone deadline?	t	2026-06-25 06:13:13.760729+00
c9de1b64-654b-4dd7-8f0e-12ce1a48204a	9a4bcb03-e3d7-4f0d-873e-74b09d248097	GQK2919AHEJ8CX9J1ICTXCWNPGW90JPKL0BLV0PRKGYC4OM3WTOOBMZV	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	Hi, I have a question about the milestones. Could we adjust the second milestone deadline?	t	2026-06-25 16:13:13.760729+00
6f1feb9b-70d9-408e-9212-a5c1d84ba874	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	GQ3TMY4GPYWSSBZRAD5SOWOMQIGCT2CXIFSU0LMI8X76RKQ4SVH3EJOZ	GKF51VG7CON4RCER8CLUBNJZETKPY8VYIF6WDG1OEVZUBR25OW9Y1LYF	I have pushed the first deliverable to the repo. Let me know if the tests pass.	f	2026-06-27 17:13:13.760779+00
4984ffbe-b043-452c-9f68-8c8da8870c49	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	GQ3TMY4GPYWSSBZRAD5SOWOMQIGCT2CXIFSU0LMI8X76RKQ4SVH3EJOZ	GKF51VG7CON4RCER8CLUBNJZETKPY8VYIF6WDG1OEVZUBR25OW9Y1LYF	Can you share the Horizon network passphrase you want me to use?	t	2026-06-25 22:13:13.760779+00
99f4d88f-2346-4a1e-aaf5-5a6d87e70f62	249e0244-7263-4347-9003-c40eeeadb1e9	GHKTGBTYZMEPGTHCW81XE6VA05G1X3J1L7R8431RUPFR2P3YVB5UL5NW	GG73AJ0JE4QVZFV8YU58CEPSOF1GG2KTBCUDSWX1JP70LKLFYP5JO3Q3	Great work! The release transaction was confirmed on Stellar.	t	2026-05-29 06:13:13.760832+00
712a8323-6d7c-437a-9788-9a5b4121baec	249e0244-7263-4347-9003-c40eeeadb1e9	GHKTGBTYZMEPGTHCW81XE6VA05G1X3J1L7R8431RUPFR2P3YVB5UL5NW	GG73AJ0JE4QVZFV8YU58CEPSOF1GG2KTBCUDSWX1JP70LKLFYP5JO3Q3	Please review the PR when you have a moment.	t	2026-05-30 15:13:13.760832+00
6b45eac2-95b6-485a-ac9c-62b842e21a25	249e0244-7263-4347-9003-c40eeeadb1e9	GHKTGBTYZMEPGTHCW81XE6VA05G1X3J1L7R8431RUPFR2P3YVB5UL5NW	GG73AJ0JE4QVZFV8YU58CEPSOF1GG2KTBCUDSWX1JP70LKLFYP5JO3Q3	Hi, I have a question about the milestones. Could we adjust the second milestone deadline?	t	2026-05-31 19:13:13.760832+00
c9c0fbb1-d077-43bb-8f22-355ef3c9acc6	97e76a83-56be-438d-8980-0b021aa4ac82	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	G5YHP5E7AXUIY0X8L4EBEAQNCDZ6S601ZF88JRFTF6NJ8UZET1PDPF1H	I have pushed the first deliverable to the repo. Let me know if the tests pass.	t	2026-08-13 07:13:13.760849+00
d5e539a4-559a-4921-b906-b8174d0e4271	97e76a83-56be-438d-8980-0b021aa4ac82	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	G5YHP5E7AXUIY0X8L4EBEAQNCDZ6S601ZF88JRFTF6NJ8UZET1PDPF1H	Great work! The release transaction was confirmed on Stellar.	t	2026-08-13 12:13:13.760849+00
cd804417-8d26-43fd-a7eb-0d83228821f1	97e76a83-56be-438d-8980-0b021aa4ac82	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	G5YHP5E7AXUIY0X8L4EBEAQNCDZ6S601ZF88JRFTF6NJ8UZET1PDPF1H	Please review the PR when you have a moment.	t	2026-08-13 12:13:13.760849+00
8153c4a9-a551-4af7-8bf1-35499b163b47	97e76a83-56be-438d-8980-0b021aa4ac82	G5YHP5E7AXUIY0X8L4EBEAQNCDZ6S601ZF88JRFTF6NJ8UZET1PDPF1H	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	Thanks for the clarification. I will start on the contract today.	f	2026-08-13 01:13:13.760849+00
bcdb46d1-78e1-47a9-92c7-19df11b08f31	97e76a83-56be-438d-8980-0b021aa4ac82	G5YHP5E7AXUIY0X8L4EBEAQNCDZ6S601ZF88JRFTF6NJ8UZET1PDPF1H	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	Hi, I have a question about the milestones. Could we adjust the second milestone deadline?	t	2026-08-12 11:13:13.760849+00
eb41d620-d898-4df1-8c18-a513ca04a7a7	97e76a83-56be-438d-8980-0b021aa4ac82	G5YHP5E7AXUIY0X8L4EBEAQNCDZ6S601ZF88JRFTF6NJ8UZET1PDPF1H	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	Great work! The release transaction was confirmed on Stellar.	f	2026-08-12 19:13:13.760849+00
5646c0e1-263f-48e3-9d34-6f0c78b12d09	97e76a83-56be-438d-8980-0b021aa4ac82	G5YHP5E7AXUIY0X8L4EBEAQNCDZ6S601ZF88JRFTF6NJ8UZET1PDPF1H	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	I have pushed the first deliverable to the repo. Let me know if the tests pass.	f	2026-08-12 15:13:13.760849+00
aefe30a4-7d13-4ec3-b21f-70089094cfd6	57192032-1abb-4169-9d39-bdb57a9b428f	GLLPUWBWJM58TL5CFDOOB74AVMIVLUDBJJH7XEXZGVTUIK15UL9WOLYT	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	Great work! The release transaction was confirmed on Stellar.	t	2026-07-22 09:13:13.760863+00
e09a54f7-1e34-4ff1-b2e1-b2b4b4219b54	57192032-1abb-4169-9d39-bdb57a9b428f	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	GLLPUWBWJM58TL5CFDOOB74AVMIVLUDBJJH7XEXZGVTUIK15UL9WOLYT	Hi, I have a question about the milestones. Could we adjust the second milestone deadline?	f	2026-07-23 18:13:13.760863+00
967a5fab-456d-40b3-abce-7971c162d1dc	57192032-1abb-4169-9d39-bdb57a9b428f	GLLPUWBWJM58TL5CFDOOB74AVMIVLUDBJJH7XEXZGVTUIK15UL9WOLYT	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	Please review the PR when you have a moment.	t	2026-07-22 02:13:13.760863+00
efa0b7cb-6aa5-4eb5-83c1-71e74351c0be	57192032-1abb-4169-9d39-bdb57a9b428f	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	GLLPUWBWJM58TL5CFDOOB74AVMIVLUDBJJH7XEXZGVTUIK15UL9WOLYT	Great work! The release transaction was confirmed on Stellar.	t	2026-07-24 01:13:13.760863+00
d458f32c-94aa-4eaf-bf15-7190d31b9b91	57192032-1abb-4169-9d39-bdb57a9b428f	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	GLLPUWBWJM58TL5CFDOOB74AVMIVLUDBJJH7XEXZGVTUIK15UL9WOLYT	The escrow contract has been deployed. Here is the contract ID: None	t	2026-07-22 21:13:13.760863+00
2074a073-62cd-4555-80b3-58d8e35c2f21	57192032-1abb-4169-9d39-bdb57a9b428f	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	GLLPUWBWJM58TL5CFDOOB74AVMIVLUDBJJH7XEXZGVTUIK15UL9WOLYT	I will need access to the staging environment to complete QA.	t	2026-07-24 07:13:13.760863+00
1a1f9eda-ee91-4b03-b85f-0f2d11106499	57192032-1abb-4169-9d39-bdb57a9b428f	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	GLLPUWBWJM58TL5CFDOOB74AVMIVLUDBJJH7XEXZGVTUIK15UL9WOLYT	Please review the PR when you have a moment.	t	2026-07-24 02:13:13.760863+00
ad6ce336-f8aa-4c73-9d47-7807fefa81b7	57192032-1abb-4169-9d39-bdb57a9b428f	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	GLLPUWBWJM58TL5CFDOOB74AVMIVLUDBJJH7XEXZGVTUIK15UL9WOLYT	Thanks for the clarification. I will start on the contract today.	f	2026-07-24 07:13:13.760863+00
7d978f58-d04f-464a-84ef-065a96d4892f	b58a7d47-2106-4e8c-9051-fdc81013b0c9	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	G1Z5BY1LWNLRR2JCPS5094DFRYI0M7P8BYW485W6UYRLBUOBRD47WOKG	Hi, I have a question about the milestones. Could we adjust the second milestone deadline?	t	2026-08-15 19:13:13.760871+00
759cf778-1a4f-4eda-af32-5ddd8a01aede	b58a7d47-2106-4e8c-9051-fdc81013b0c9	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	G1Z5BY1LWNLRR2JCPS5094DFRYI0M7P8BYW485W6UYRLBUOBRD47WOKG	Great work! The release transaction was confirmed on Stellar.	t	2026-08-13 19:13:13.760871+00
178b328c-2e7e-4a5c-a393-80b6a47f482e	b58a7d47-2106-4e8c-9051-fdc81013b0c9	G1Z5BY1LWNLRR2JCPS5094DFRYI0M7P8BYW485W6UYRLBUOBRD47WOKG	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	Thanks for the clarification. I will start on the contract today.	f	2026-08-14 14:13:13.760871+00
\.


--
-- Data for Name: ml_ranking_shadow_events; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.ml_ranking_shadow_events (id, mode, subject_key, context_key, ml_ranking, baseline_ranking, latency_ms, fallback_used, created_at) FROM stdin;
\.


--
-- Data for Name: multi_level_payouts; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.multi_level_payouts (id, job_id, freelancer_address, recipient_address, level, amount_xlm, contract_tx_hash, created_at) FROM stdin;
\.


--
-- Data for Name: notification_preferences; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.notification_preferences (id, user_address, notification_type, channel, enabled, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.notifications (id, user_address, type, title, body, read, job_id, link_path, created_at) FROM stdin;
9fe94432-4701-46f7-a1e7-e571991e4424	G1CBFNO6B9M80O2RAK1VRJNVGFYGWWQC38HYF9SXMECOSFOGYR3XKXWN	escrow_released	Notification: Message	You have a new update regarding Create a Rust service that indexes Horizon API events.	t	542fd826-c128-494a-ae70-d8d0ff8ab92f	/jobs/542fd826-c128-494a-ae70-d8d0ff8ab92f	2026-08-26 20:13:14.26198+00
1a6a7102-7181-4cc5-944d-18b061693175	G1CBFNO6B9M80O2RAK1VRJNVGFYGWWQC38HYF9SXMECOSFOGYR3XKXWN	new_message	Update: Payment	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	t	9d5b219d-7605-4b8e-8a0d-fabadbd58014	/jobs/9d5b219d-7605-4b8e-8a0d-fabadbd58014	2026-08-26 20:13:14.26198+00
794dc8e6-2e83-489c-b3a0-822481385dc2	G1CBFNO6B9M80O2RAK1VRJNVGFYGWWQC38HYF9SXMECOSFOGYR3XKXWN	escrow_released	Notification: Job	You have a new update regarding Design an admin dashboard for dispute resolution.	t	aed25e1a-56d0-41de-95d3-3f87f58211df	/jobs/aed25e1a-56d0-41de-95d3-3f87f58211df	2026-08-26 20:13:14.26198+00
db108848-a81c-40d1-a00b-f7c3928dffc9	GYR9OUDOCUZRENUN5Z3JQIP98Q1ZXOI65FDHJK1EYY37Q9AH8RVHS1K3	escrow_released	Update: Job	You have a new update regarding Build a Soroban escrow contract for freelance payments.	f	46655f7b-1ae1-417c-be78-44f9e68055d4	/jobs/46655f7b-1ae1-417c-be78-44f9e68055d4	2026-08-26 20:13:14.26198+00
2936151b-0e40-449f-a855-96ae56740e13	GYR9OUDOCUZRENUN5Z3JQIP98Q1ZXOI65FDHJK1EYY37Q9AH8RVHS1K3	escrow_released	Notification: Message	You have a new update regarding Create a CDN invalidation microservice.	f	fad32b56-3761-41ba-b671-964232d2cade	/jobs/fad32b56-3761-41ba-b671-964232d2cade	2026-08-26 20:13:14.26198+00
43dc50c7-aa0e-4419-93e7-2c21d7563754	GYR9OUDOCUZRENUN5Z3JQIP98Q1ZXOI65FDHJK1EYY37Q9AH8RVHS1K3	job_completed	Alert: Payment	You have a new update regarding Design a responsive UI for a decentralised job board.	t	9a4bcb03-e3d7-4f0d-873e-74b09d248097	/jobs/9a4bcb03-e3d7-4f0d-873e-74b09d248097	2026-08-26 20:13:14.26198+00
fd52e97a-913a-4ec7-bf48-a4a565b1b935	GYR9OUDOCUZRENUN5Z3JQIP98Q1ZXOI65FDHJK1EYY37Q9AH8RVHS1K3	escrow_released	Alert: Message	You have a new update regarding Develop a mobile app for Stellar wallet onboarding.	f	74168a8c-e4aa-4e6a-88b0-a29ae4645e05	/jobs/74168a8c-e4aa-4e6a-88b0-a29ae4645e05	2026-08-26 20:13:14.26198+00
b17d495c-a170-4f9f-82e3-bc925e1f1657	GXK87AU5BHXTPDPFF5E8II49KQ71N8MTZX272HPOEVB9OOAEDOECVE6P	rating_received	Alert: Message	You have a new update regarding Create a CDN invalidation microservice.	t	fad32b56-3761-41ba-b671-964232d2cade	/jobs/fad32b56-3761-41ba-b671-964232d2cade	2026-08-26 20:13:14.26198+00
5b8a66fe-71bf-47ee-94ef-2b9dd8003e6c	G103DGDZVGPMM82I1LR3PE29GD8AFPK054NZDKYAYQ3S195JMSND8DUD	job_completed	Notification: Payment	You have a new update regarding Build a Soroban escrow contract for freelance payments.	t	46655f7b-1ae1-417c-be78-44f9e68055d4	/jobs/46655f7b-1ae1-417c-be78-44f9e68055d4	2026-08-26 20:13:14.26198+00
a8663e45-b37a-4d93-ba9e-3e38a27cd480	G103DGDZVGPMM82I1LR3PE29GD8AFPK054NZDKYAYQ3S195JMSND8DUD	new_message	Update: Job	You have a new update regarding Set up Kubernetes blue-green deployment for Node.js API.	t	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	/jobs/d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	2026-08-26 20:13:14.26198+00
64025df0-a9ff-48f7-b2d2-7885a32a4c62	G103DGDZVGPMM82I1LR3PE29GD8AFPK054NZDKYAYQ3S195JMSND8DUD	escrow_released	Update: Job	You have a new update regarding Build a Soroban escrow contract for freelance payments.	f	33900b8b-00fd-429d-8731-00631a2a2e2e	/jobs/33900b8b-00fd-429d-8731-00631a2a2e2e	2026-08-26 20:13:14.26198+00
1a0d533c-11ca-4355-b491-3717d4d6b1e1	G103DGDZVGPMM82I1LR3PE29GD8AFPK054NZDKYAYQ3S195JMSND8DUD	new_message	Notification: Job	You have a new update regarding Build a Soroban escrow contract for freelance payments.	f	46655f7b-1ae1-417c-be78-44f9e68055d4	/jobs/46655f7b-1ae1-417c-be78-44f9e68055d4	2026-08-26 20:13:14.26198+00
c0c20526-dd1f-4065-a4a8-811137f00a30	GEPZHPCF07UQNUPQZIT3UEA3GE8N6QIWEPXSK28T7A9TGIQHG9JRSNVN	escrow_released	Notification: Payment	You have a new update regarding Design a responsive UI for a decentralised job board.	t	d9d1a321-9802-4515-ab3b-0d82a7c33e12	/jobs/d9d1a321-9802-4515-ab3b-0d82a7c33e12	2026-08-26 20:13:14.26198+00
7b7fd286-2707-4e7f-9240-5b87ccacbd7d	GEPZHPCF07UQNUPQZIT3UEA3GE8N6QIWEPXSK28T7A9TGIQHG9JRSNVN	rating_received	Alert: Payment	You have a new update regarding Create a Rust service that indexes Horizon API events.	f	542fd826-c128-494a-ae70-d8d0ff8ab92f	/jobs/542fd826-c128-494a-ae70-d8d0ff8ab92f	2026-08-26 20:13:14.26198+00
c5d50dfe-6378-4689-ab63-b2f1762f7bd0	GEPZHPCF07UQNUPQZIT3UEA3GE8N6QIWEPXSK28T7A9TGIQHG9JRSNVN	new_message	Notification: Message	You have a new update regarding Design an admin dashboard for dispute resolution.	f	27efcb05-6c80-4111-b603-f64c46caaaf1	/jobs/27efcb05-6c80-4111-b603-f64c46caaaf1	2026-08-26 20:13:14.26198+00
23b015fb-8494-4908-a3f7-bc8b870bfe4c	GEPZHPCF07UQNUPQZIT3UEA3GE8N6QIWEPXSK28T7A9TGIQHG9JRSNVN	job_completed	Update: Message	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	f	9d5b219d-7605-4b8e-8a0d-fabadbd58014	/jobs/9d5b219d-7605-4b8e-8a0d-fabadbd58014	2026-08-26 20:13:14.26198+00
9d9355a0-3a32-4bb8-aace-6774007cade0	GEPZHPCF07UQNUPQZIT3UEA3GE8N6QIWEPXSK28T7A9TGIQHG9JRSNVN	rating_received	Notification: Message	You have a new update regarding Design a responsive UI for a decentralised job board.	t	9a4bcb03-e3d7-4f0d-873e-74b09d248097	/jobs/9a4bcb03-e3d7-4f0d-873e-74b09d248097	2026-08-26 20:13:14.26198+00
f85e144a-cb76-40e7-9767-6bad2a29985e	GQK2919AHEJ8CX9J1ICTXCWNPGW90JPKL0BLV0PRKGYC4OM3WTOOBMZV	rating_received	Alert: Message	You have a new update regarding Design an admin dashboard for dispute resolution.	f	aed25e1a-56d0-41de-95d3-3f87f58211df	/jobs/aed25e1a-56d0-41de-95d3-3f87f58211df	2026-08-26 20:13:14.26198+00
43361b7f-cb17-4a4b-b105-8a3507693b5a	GG1WU16HYMQC1A78MX1EVUHT6T0UZS9IM0YLTZ9ATSN1U322N64KFS6V	application_received	Alert: Job	You have a new update regarding Design a responsive UI for a decentralised job board.	t	4c8bd166-dffc-4575-9c78-70031530c30e	/jobs/4c8bd166-dffc-4575-9c78-70031530c30e	2026-08-26 20:13:14.26198+00
2ab1f94d-6aa9-4114-bca0-c11f8505d600	GG1WU16HYMQC1A78MX1EVUHT6T0UZS9IM0YLTZ9ATSN1U322N64KFS6V	rating_received	Alert: Job	You have a new update regarding Develop a mobile app for Stellar wallet onboarding.	f	74168a8c-e4aa-4e6a-88b0-a29ae4645e05	/jobs/74168a8c-e4aa-4e6a-88b0-a29ae4645e05	2026-08-26 20:13:14.26198+00
d64edf68-1303-4cfe-adf0-c8d770906421	GG1WU16HYMQC1A78MX1EVUHT6T0UZS9IM0YLTZ9ATSN1U322N64KFS6V	escrow_released	Alert: Job	You have a new update regarding Design a responsive UI for a decentralised job board.	t	9a4bcb03-e3d7-4f0d-873e-74b09d248097	/jobs/9a4bcb03-e3d7-4f0d-873e-74b09d248097	2026-08-26 20:13:14.26198+00
a11a3ca1-375f-45b1-bc1e-eb0453cee183	GG1WU16HYMQC1A78MX1EVUHT6T0UZS9IM0YLTZ9ATSN1U322N64KFS6V	new_message	Alert: Job	You have a new update regarding Build a Soroban escrow contract for freelance payments.	f	33900b8b-00fd-429d-8731-00631a2a2e2e	/jobs/33900b8b-00fd-429d-8731-00631a2a2e2e	2026-08-26 20:13:14.26198+00
12676504-bc78-4b24-8b0b-ea34c1ce6a15	G0MY5ZPJAG1OL73D9PH3I379U26192K42QPR75PR2ESPRVU8FIJOYJNE	new_message	Alert: Payment	You have a new update regarding Develop a mobile app for Stellar wallet onboarding.	t	74168a8c-e4aa-4e6a-88b0-a29ae4645e05	/jobs/74168a8c-e4aa-4e6a-88b0-a29ae4645e05	2026-08-26 20:13:14.26198+00
255f9409-c331-4896-8b53-ff2961f02b68	GY4AWTY088O5OR15BYVZK3I8BZBF1I3LDQYUN3UVYR0QF4B8DWOECBPM	escrow_released	Alert: Job	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	t	9d5b219d-7605-4b8e-8a0d-fabadbd58014	/jobs/9d5b219d-7605-4b8e-8a0d-fabadbd58014	2026-08-26 20:13:14.26198+00
78661694-45e7-4357-977a-335fb7d8c777	GY4AWTY088O5OR15BYVZK3I8BZBF1I3LDQYUN3UVYR0QF4B8DWOECBPM	job_completed	Notification: Job	You have a new update regarding Build a real-time notification service with WebSockets.	f	57192032-1abb-4169-9d39-bdb57a9b428f	/jobs/57192032-1abb-4169-9d39-bdb57a9b428f	2026-08-26 20:13:14.26198+00
33e788c8-b4e9-4785-9530-99bd5717e9ab	GHKTGBTYZMEPGTHCW81XE6VA05G1X3J1L7R8431RUPFR2P3YVB5UL5NW	job_completed	Alert: Message	You have a new update regarding Design a responsive UI for a decentralised job board.	f	9a4bcb03-e3d7-4f0d-873e-74b09d248097	/jobs/9a4bcb03-e3d7-4f0d-873e-74b09d248097	2026-08-26 20:13:14.26198+00
58b15e97-8209-4c1e-bfb7-9567b5e2fe9e	G9P452BFSOZPTX497W19VW3RTQOHMUH8LMN4R7SGMSOXLTA8IRCD9SI5	new_message	Update: Job	You have a new update regarding Develop a mobile app for Stellar wallet onboarding.	f	74168a8c-e4aa-4e6a-88b0-a29ae4645e05	/jobs/74168a8c-e4aa-4e6a-88b0-a29ae4645e05	2026-08-26 20:13:14.26198+00
8e734f18-193f-447a-8aac-d291d86ae19d	G9P452BFSOZPTX497W19VW3RTQOHMUH8LMN4R7SGMSOXLTA8IRCD9SI5	application_received	Alert: Message	You have a new update regarding Migrate a legacy Express API to TypeScript.	t	b58a7d47-2106-4e8c-9051-fdc81013b0c9	/jobs/b58a7d47-2106-4e8c-9051-fdc81013b0c9	2026-08-26 20:13:14.26198+00
e13519fb-edb1-45f9-bda1-f6338ed22b63	GEZ5EDJJTFPH90O7Y22T1TDGNNQFKPL9EKA024SCOSS3EOQM1H8OJRJE	application_received	Update: Payment	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	t	9d5b219d-7605-4b8e-8a0d-fabadbd58014	/jobs/9d5b219d-7605-4b8e-8a0d-fabadbd58014	2026-08-26 20:13:14.26198+00
78de2c5d-9a08-4748-86e4-5054e4223d21	GEZ5EDJJTFPH90O7Y22T1TDGNNQFKPL9EKA024SCOSS3EOQM1H8OJRJE	rating_received	Notification: Message	You have a new update regarding Migrate a legacy Express API to TypeScript.	t	97e76a83-56be-438d-8980-0b021aa4ac82	/jobs/97e76a83-56be-438d-8980-0b021aa4ac82	2026-08-26 20:13:14.26198+00
1fa42ef5-ba19-43db-9c21-178a385a6c28	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	rating_received	Update: Payment	You have a new update regarding Design a responsive UI for a decentralised job board.	t	d9d1a321-9802-4515-ab3b-0d82a7c33e12	/jobs/d9d1a321-9802-4515-ab3b-0d82a7c33e12	2026-08-26 20:13:14.26198+00
6f1571c4-c47d-4b0d-b046-fbdb50518f27	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	new_message	Alert: Job	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	f	9d5b219d-7605-4b8e-8a0d-fabadbd58014	/jobs/9d5b219d-7605-4b8e-8a0d-fabadbd58014	2026-08-26 20:13:14.26198+00
74066b16-b78c-4b75-85c8-c45d5ed60456	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	application_received	Notification: Message	You have a new update regarding Design an admin dashboard for dispute resolution.	f	aed25e1a-56d0-41de-95d3-3f87f58211df	/jobs/aed25e1a-56d0-41de-95d3-3f87f58211df	2026-08-26 20:13:14.26198+00
10d47ec4-9696-4887-bd54-6c7b0cedc366	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	application_received	Update: Job	You have a new update regarding Migrate a legacy Express API to TypeScript.	f	97e76a83-56be-438d-8980-0b021aa4ac82	/jobs/97e76a83-56be-438d-8980-0b021aa4ac82	2026-08-26 20:13:14.26198+00
69cff908-723a-4072-9033-707230abe230	GKT9A90FOH3HJ5S6R044P39JYM6IER0V6RAST5J284WV98Y3UMPYO0CU	job_completed	Notification: Message	You have a new update regarding Set up Kubernetes blue-green deployment for Node.js API.	f	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	/jobs/d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	2026-08-26 20:13:14.26198+00
c8f86056-2832-4627-99b8-170a88aa99a3	GKT9A90FOH3HJ5S6R044P39JYM6IER0V6RAST5J284WV98Y3UMPYO0CU	job_completed	Notification: Job	You have a new update regarding Build a Soroban escrow contract for freelance payments.	f	a2b96648-2ef9-4f5e-a313-346b9f8db3ab	/jobs/a2b96648-2ef9-4f5e-a313-346b9f8db3ab	2026-08-26 20:13:14.26198+00
f1a9736d-549b-4221-a952-f73be4156876	GKT9A90FOH3HJ5S6R044P39JYM6IER0V6RAST5J284WV98Y3UMPYO0CU	escrow_released	Alert: Payment	You have a new update regarding Set up Kubernetes blue-green deployment for Node.js API.	t	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	/jobs/d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	2026-08-26 20:13:14.26198+00
d45ca516-9d83-4e07-b185-4c397d8c9991	GKT9A90FOH3HJ5S6R044P39JYM6IER0V6RAST5J284WV98Y3UMPYO0CU	new_message	Update: Message	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	f	9d5b219d-7605-4b8e-8a0d-fabadbd58014	/jobs/9d5b219d-7605-4b8e-8a0d-fabadbd58014	2026-08-26 20:13:14.26198+00
dfeeea8e-c3b2-4964-b573-155a8c02312b	GKT9A90FOH3HJ5S6R044P39JYM6IER0V6RAST5J284WV98Y3UMPYO0CU	new_message	Notification: Message	You have a new update regarding Create a CDN invalidation microservice.	f	fad32b56-3761-41ba-b671-964232d2cade	/jobs/fad32b56-3761-41ba-b671-964232d2cade	2026-08-26 20:13:14.26198+00
d9c6f65b-c173-4a0b-804b-6a9048bf54dc	GG73AJ0JE4QVZFV8YU58CEPSOF1GG2KTBCUDSWX1JP70LKLFYP5JO3Q3	rating_received	Update: Job	You have a new update regarding Design a responsive UI for a decentralised job board.	t	d9d1a321-9802-4515-ab3b-0d82a7c33e12	/jobs/d9d1a321-9802-4515-ab3b-0d82a7c33e12	2026-08-26 20:13:14.26198+00
d046d5a8-3715-4c94-9f0e-f43e29b0b9f3	GG73AJ0JE4QVZFV8YU58CEPSOF1GG2KTBCUDSWX1JP70LKLFYP5JO3Q3	escrow_released	Update: Job	You have a new update regarding Migrate a legacy Express API to TypeScript.	f	b58a7d47-2106-4e8c-9051-fdc81013b0c9	/jobs/b58a7d47-2106-4e8c-9051-fdc81013b0c9	2026-08-26 20:13:14.26198+00
75618ff5-676c-4a57-b6b6-cc9e4216c761	GG73AJ0JE4QVZFV8YU58CEPSOF1GG2KTBCUDSWX1JP70LKLFYP5JO3Q3	escrow_released	Alert: Message	You have a new update regarding Build a Soroban escrow contract for freelance payments.	f	33900b8b-00fd-429d-8731-00631a2a2e2e	/jobs/33900b8b-00fd-429d-8731-00631a2a2e2e	2026-08-26 20:13:14.26198+00
411d4fc6-856c-4104-8fcb-678fbd0e844c	GG73AJ0JE4QVZFV8YU58CEPSOF1GG2KTBCUDSWX1JP70LKLFYP5JO3Q3	rating_received	Alert: Message	You have a new update regarding Write end-to-end Playwright tests for checkout flow.	f	db8441d7-dcfe-4221-b09a-99e5242110e0	/jobs/db8441d7-dcfe-4221-b09a-99e5242110e0	2026-08-26 20:13:14.26198+00
d7e2cf5f-90a4-4aca-be76-14e9826f9821	GG73AJ0JE4QVZFV8YU58CEPSOF1GG2KTBCUDSWX1JP70LKLFYP5JO3Q3	escrow_released	Update: Payment	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	t	9d5b219d-7605-4b8e-8a0d-fabadbd58014	/jobs/9d5b219d-7605-4b8e-8a0d-fabadbd58014	2026-08-26 20:13:14.26198+00
0a359496-8701-4f6a-99c6-57a208b32be0	GQ3TMY4GPYWSSBZRAD5SOWOMQIGCT2CXIFSU0LMI8X76RKQ4SVH3EJOZ	escrow_released	Notification: Message	You have a new update regarding Develop a mobile app for Stellar wallet onboarding.	t	74168a8c-e4aa-4e6a-88b0-a29ae4645e05	/jobs/74168a8c-e4aa-4e6a-88b0-a29ae4645e05	2026-08-26 20:13:14.26198+00
68fb1c43-19a7-40e3-b785-c1f3a76fb1ea	GQ3TMY4GPYWSSBZRAD5SOWOMQIGCT2CXIFSU0LMI8X76RKQ4SVH3EJOZ	job_completed	Alert: Message	You have a new update regarding Design a responsive UI for a decentralised job board.	t	9a4bcb03-e3d7-4f0d-873e-74b09d248097	/jobs/9a4bcb03-e3d7-4f0d-873e-74b09d248097	2026-08-26 20:13:14.26198+00
e251b263-afcd-40c4-907e-15894d5bccad	GYXGO4B9UOE3T0HICCT5HGP8IY3X80J0G50RCXN22PXGX8WDZRMH3FNB	escrow_released	Notification: Payment	You have a new update regarding Design a responsive UI for a decentralised job board.	f	9a4bcb03-e3d7-4f0d-873e-74b09d248097	/jobs/9a4bcb03-e3d7-4f0d-873e-74b09d248097	2026-08-26 20:13:14.26198+00
2d4ea0ac-628f-455a-a256-cffb1d6e1dec	GYXGO4B9UOE3T0HICCT5HGP8IY3X80J0G50RCXN22PXGX8WDZRMH3FNB	rating_received	Update: Message	You have a new update regarding Build a real-time notification service with WebSockets.	t	57192032-1abb-4169-9d39-bdb57a9b428f	/jobs/57192032-1abb-4169-9d39-bdb57a9b428f	2026-08-26 20:13:14.26198+00
2ab1e199-a484-42ab-a5b2-a51ef8f47b1b	GYXGO4B9UOE3T0HICCT5HGP8IY3X80J0G50RCXN22PXGX8WDZRMH3FNB	rating_received	Notification: Payment	You have a new update regarding Build a Soroban escrow contract for freelance payments.	f	33900b8b-00fd-429d-8731-00631a2a2e2e	/jobs/33900b8b-00fd-429d-8731-00631a2a2e2e	2026-08-26 20:13:14.26198+00
86f4a08f-db02-4820-abe8-77569a875a94	GYXGO4B9UOE3T0HICCT5HGP8IY3X80J0G50RCXN22PXGX8WDZRMH3FNB	new_message	Alert: Job	You have a new update regarding Design an admin dashboard for dispute resolution.	f	aed25e1a-56d0-41de-95d3-3f87f58211df	/jobs/aed25e1a-56d0-41de-95d3-3f87f58211df	2026-08-26 20:13:14.26198+00
447393df-5628-40fb-a241-3d36d151bece	GYXGO4B9UOE3T0HICCT5HGP8IY3X80J0G50RCXN22PXGX8WDZRMH3FNB	new_message	Notification: Job	You have a new update regarding Write end-to-end Playwright tests for checkout flow.	t	db8441d7-dcfe-4221-b09a-99e5242110e0	/jobs/db8441d7-dcfe-4221-b09a-99e5242110e0	2026-08-26 20:13:14.26198+00
d9add2ff-041b-451f-9228-95750f4aea2e	GJARJI8QLHBIAWPUBLQDI07HE42X6G26OC7T3BD4Z1G52EFUJEIR9UY7	escrow_released	Update: Job	You have a new update regarding Design an admin dashboard for dispute resolution.	t	27efcb05-6c80-4111-b603-f64c46caaaf1	/jobs/27efcb05-6c80-4111-b603-f64c46caaaf1	2026-08-26 20:13:14.26198+00
ef8b5949-77f8-44f4-aa93-8f60a2cc0156	GJARJI8QLHBIAWPUBLQDI07HE42X6G26OC7T3BD4Z1G52EFUJEIR9UY7	rating_received	Alert: Job	You have a new update regarding Design a responsive UI for a decentralised job board.	t	d9d1a321-9802-4515-ab3b-0d82a7c33e12	/jobs/d9d1a321-9802-4515-ab3b-0d82a7c33e12	2026-08-26 20:13:14.26198+00
e0d35602-aa4e-44fa-8551-ecd57083089c	GJARJI8QLHBIAWPUBLQDI07HE42X6G26OC7T3BD4Z1G52EFUJEIR9UY7	new_message	Notification: Payment	You have a new update regarding Build a Soroban escrow contract for freelance payments.	t	249e0244-7263-4347-9003-c40eeeadb1e9	/jobs/249e0244-7263-4347-9003-c40eeeadb1e9	2026-08-26 20:13:14.26198+00
dc0bf0c8-b51c-486d-982b-7d8b39ce2eee	G3Z0GU1UQXJ4EFFF1GXI9D99VH0W1DSTWG6NJ4OGW9XHRO199BRBLRTV	job_completed	Notification: Payment	You have a new update regarding Design an admin dashboard for dispute resolution.	t	27efcb05-6c80-4111-b603-f64c46caaaf1	/jobs/27efcb05-6c80-4111-b603-f64c46caaaf1	2026-08-26 20:13:14.26198+00
661fc71a-56e9-4511-8d2e-0fa7f75ea7b0	G3Z0GU1UQXJ4EFFF1GXI9D99VH0W1DSTWG6NJ4OGW9XHRO199BRBLRTV	application_received	Notification: Payment	You have a new update regarding Design an admin dashboard for dispute resolution.	t	aed25e1a-56d0-41de-95d3-3f87f58211df	/jobs/aed25e1a-56d0-41de-95d3-3f87f58211df	2026-08-26 20:13:14.26198+00
8bac5513-a6a4-4a36-affb-0642825c1cc5	G3Z0GU1UQXJ4EFFF1GXI9D99VH0W1DSTWG6NJ4OGW9XHRO199BRBLRTV	rating_received	Alert: Payment	You have a new update regarding Design a responsive UI for a decentralised job board.	t	d9d1a321-9802-4515-ab3b-0d82a7c33e12	/jobs/d9d1a321-9802-4515-ab3b-0d82a7c33e12	2026-08-26 20:13:14.26198+00
ace8a0c7-c7ce-4da8-8a14-5b5278706cc1	G3Z0GU1UQXJ4EFFF1GXI9D99VH0W1DSTWG6NJ4OGW9XHRO199BRBLRTV	new_message	Alert: Payment	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	t	47dfd2a5-c4f1-4e70-adbe-d8577df19b91	/jobs/47dfd2a5-c4f1-4e70-adbe-d8577df19b91	2026-08-26 20:13:14.26198+00
46f6816e-f0ff-409e-ab2f-dce46e036ee6	G3Z0GU1UQXJ4EFFF1GXI9D99VH0W1DSTWG6NJ4OGW9XHRO199BRBLRTV	escrow_released	Alert: Job	You have a new update regarding Design an admin dashboard for dispute resolution.	t	27efcb05-6c80-4111-b603-f64c46caaaf1	/jobs/27efcb05-6c80-4111-b603-f64c46caaaf1	2026-08-26 20:13:14.26198+00
d0cc11e2-b919-430e-8920-1fb5808b468f	G03VKXTUFDJKDFR21520RN6HW1HS57TCOZDANTNIQSUHA51LIY8O69WE	job_completed	Update: Payment	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	f	9d5b219d-7605-4b8e-8a0d-fabadbd58014	/jobs/9d5b219d-7605-4b8e-8a0d-fabadbd58014	2026-08-26 20:13:14.26198+00
a64cdcfd-f0bb-4b98-ad1a-392e806d5116	G03VKXTUFDJKDFR21520RN6HW1HS57TCOZDANTNIQSUHA51LIY8O69WE	escrow_released	Update: Payment	You have a new update regarding Build a Soroban escrow contract for freelance payments.	t	46655f7b-1ae1-417c-be78-44f9e68055d4	/jobs/46655f7b-1ae1-417c-be78-44f9e68055d4	2026-08-26 20:13:14.26198+00
b0271110-d604-4387-bb9a-07455a7fcc50	GUK3XF1GP1Z7FZTVOVKE6H76MWWJPGJQMLJEL532UUJ2E42TRDW6ET32	rating_received	Notification: Job	You have a new update regarding Build a Soroban escrow contract for freelance payments.	t	a2b96648-2ef9-4f5e-a313-346b9f8db3ab	/jobs/a2b96648-2ef9-4f5e-a313-346b9f8db3ab	2026-08-26 20:13:14.26198+00
effeb5aa-b1fa-439d-97b6-ff534e61fba9	GMU46JD2GVF6LCP2277KXXSY0VDVEVG9YSQJVFJWTZIFT9YVI7F16XBX	rating_received	Alert: Message	You have a new update regarding Design an admin dashboard for dispute resolution.	f	27efcb05-6c80-4111-b603-f64c46caaaf1	/jobs/27efcb05-6c80-4111-b603-f64c46caaaf1	2026-08-26 20:13:14.26198+00
ef41e940-f307-4b39-a0e3-e190af16aabd	GMU46JD2GVF6LCP2277KXXSY0VDVEVG9YSQJVFJWTZIFT9YVI7F16XBX	rating_received	Update: Message	You have a new update regarding Set up Kubernetes blue-green deployment for Node.js API.	t	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	/jobs/d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	2026-08-26 20:13:14.26198+00
e9da7904-4eff-4964-8f1e-9cc80be1cf28	G87CVIYJKLK2C0XP2S2O8PT4MX23SY670KMIQD4X9G7HSFKR26J1FO2W	application_received	Notification: Job	You have a new update regarding Build a real-time notification service with WebSockets.	f	57192032-1abb-4169-9d39-bdb57a9b428f	/jobs/57192032-1abb-4169-9d39-bdb57a9b428f	2026-08-26 20:13:14.26198+00
afd1a973-f254-4aef-b8bd-d5d588fb62c8	G87CVIYJKLK2C0XP2S2O8PT4MX23SY670KMIQD4X9G7HSFKR26J1FO2W	application_received	Alert: Payment	You have a new update regarding Design a responsive UI for a decentralised job board.	t	4c8bd166-dffc-4575-9c78-70031530c30e	/jobs/4c8bd166-dffc-4575-9c78-70031530c30e	2026-08-26 20:13:14.26198+00
6edd3058-88be-461e-849d-f11c6d1243c1	GGVJICS4I42AFBQNJ971HSPTHDP03EH58B6PJS1AWP0LF7XE78669BY4	escrow_released	Alert: Job	You have a new update regarding Build a real-time notification service with WebSockets.	f	57192032-1abb-4169-9d39-bdb57a9b428f	/jobs/57192032-1abb-4169-9d39-bdb57a9b428f	2026-08-26 20:13:14.26198+00
64b8e7f1-f90d-40dd-90ed-2c7fcc061a8a	GGVJICS4I42AFBQNJ971HSPTHDP03EH58B6PJS1AWP0LF7XE78669BY4	new_message	Alert: Job	You have a new update regarding Set up Kubernetes blue-green deployment for Node.js API.	f	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	/jobs/d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	2026-08-26 20:13:14.26198+00
b2e24b54-68b6-4eb0-aaac-65133cc90855	GGVJICS4I42AFBQNJ971HSPTHDP03EH58B6PJS1AWP0LF7XE78669BY4	escrow_released	Notification: Payment	You have a new update regarding Design a responsive UI for a decentralised job board.	f	9a4bcb03-e3d7-4f0d-873e-74b09d248097	/jobs/9a4bcb03-e3d7-4f0d-873e-74b09d248097	2026-08-26 20:13:14.26198+00
2d40f354-7049-4ce2-9313-8634aea1c3d8	GGVJICS4I42AFBQNJ971HSPTHDP03EH58B6PJS1AWP0LF7XE78669BY4	job_completed	Notification: Payment	You have a new update regarding Build a real-time notification service with WebSockets.	f	57192032-1abb-4169-9d39-bdb57a9b428f	/jobs/57192032-1abb-4169-9d39-bdb57a9b428f	2026-08-26 20:13:14.26198+00
b8310310-e4c5-4445-9cd7-5b12c5abeb34	GGVJICS4I42AFBQNJ971HSPTHDP03EH58B6PJS1AWP0LF7XE78669BY4	escrow_released	Alert: Message	You have a new update regarding Migrate a legacy Express API to TypeScript.	f	b58a7d47-2106-4e8c-9051-fdc81013b0c9	/jobs/b58a7d47-2106-4e8c-9051-fdc81013b0c9	2026-08-26 20:13:14.26198+00
541156c7-a491-440c-a830-f7be12790128	GVICW8VL34LIE3CSMCMCUT6Z84QCMSWDVRHX1Z2YVL55X7RF1F1L8SUG	escrow_released	Notification: Payment	You have a new update regarding Design an admin dashboard for dispute resolution.	f	27efcb05-6c80-4111-b603-f64c46caaaf1	/jobs/27efcb05-6c80-4111-b603-f64c46caaaf1	2026-08-26 20:13:14.26198+00
d7d50ab1-2341-40c8-962e-af516b7fe94a	GVICW8VL34LIE3CSMCMCUT6Z84QCMSWDVRHX1Z2YVL55X7RF1F1L8SUG	application_received	Update: Message	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	t	9d5b219d-7605-4b8e-8a0d-fabadbd58014	/jobs/9d5b219d-7605-4b8e-8a0d-fabadbd58014	2026-08-26 20:13:14.26198+00
211f1ed7-05f1-4fa5-ae8a-e63878cd1365	GVICW8VL34LIE3CSMCMCUT6Z84QCMSWDVRHX1Z2YVL55X7RF1F1L8SUG	rating_received	Notification: Message	You have a new update regarding Create a Rust service that indexes Horizon API events.	t	542fd826-c128-494a-ae70-d8d0ff8ab92f	/jobs/542fd826-c128-494a-ae70-d8d0ff8ab92f	2026-08-26 20:13:14.26198+00
6a56b9b3-7bb8-4b4f-a0ed-e9a9b7bfeafd	GVICW8VL34LIE3CSMCMCUT6Z84QCMSWDVRHX1Z2YVL55X7RF1F1L8SUG	application_received	Notification: Payment	You have a new update regarding Write end-to-end Playwright tests for checkout flow.	f	db8441d7-dcfe-4221-b09a-99e5242110e0	/jobs/db8441d7-dcfe-4221-b09a-99e5242110e0	2026-08-26 20:13:14.26198+00
a919ad6a-c70c-4a23-81b5-8eaf5ffdaa75	GVICW8VL34LIE3CSMCMCUT6Z84QCMSWDVRHX1Z2YVL55X7RF1F1L8SUG	new_message	Notification: Payment	You have a new update regarding Set up Kubernetes blue-green deployment for Node.js API.	t	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	/jobs/d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	2026-08-26 20:13:14.26198+00
b065db19-7ae6-422d-a13f-bde113af77eb	GDEZX6KBJ2CIEPXXYCJ2XX2EI7XZURPHBL57Y9HQQ2NS5MHIE2L2FUWE	job_completed	Update: Message	You have a new update regarding Set up Kubernetes blue-green deployment for Node.js API.	f	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	/jobs/d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	2026-08-26 20:13:14.26198+00
42cd442b-3bad-4d60-85f7-3e85f7ee1b81	GDEZX6KBJ2CIEPXXYCJ2XX2EI7XZURPHBL57Y9HQQ2NS5MHIE2L2FUWE	rating_received	Notification: Job	You have a new update regarding Create a Rust service that indexes Horizon API events.	f	542fd826-c128-494a-ae70-d8d0ff8ab92f	/jobs/542fd826-c128-494a-ae70-d8d0ff8ab92f	2026-08-26 20:13:14.26198+00
99ceedb9-164d-424e-8a95-8ee7a7f09ce2	G9X39IFETZ4700EIUE237WI9LI16DH7JTKKUOW7SFQM9RIT8F6KJKVCB	rating_received	Alert: Job	You have a new update regarding Design a responsive UI for a decentralised job board.	f	4c8bd166-dffc-4575-9c78-70031530c30e	/jobs/4c8bd166-dffc-4575-9c78-70031530c30e	2026-08-26 20:13:14.26198+00
688ac7c4-d52a-42ab-8043-b31b8d50bd3d	G9X39IFETZ4700EIUE237WI9LI16DH7JTKKUOW7SFQM9RIT8F6KJKVCB	job_completed	Notification: Job	You have a new update regarding Write end-to-end Playwright tests for checkout flow.	t	db8441d7-dcfe-4221-b09a-99e5242110e0	/jobs/db8441d7-dcfe-4221-b09a-99e5242110e0	2026-08-26 20:13:14.26198+00
f67d47ce-9c6f-43e5-9a6c-4d6b521bf066	G9X39IFETZ4700EIUE237WI9LI16DH7JTKKUOW7SFQM9RIT8F6KJKVCB	job_completed	Notification: Payment	You have a new update regarding Develop a mobile app for Stellar wallet onboarding.	f	74168a8c-e4aa-4e6a-88b0-a29ae4645e05	/jobs/74168a8c-e4aa-4e6a-88b0-a29ae4645e05	2026-08-26 20:13:14.26198+00
f91b91a0-804c-45fe-aa06-9b2214c6cb96	G9X39IFETZ4700EIUE237WI9LI16DH7JTKKUOW7SFQM9RIT8F6KJKVCB	new_message	Alert: Message	You have a new update regarding Develop a mobile app for Stellar wallet onboarding.	t	74168a8c-e4aa-4e6a-88b0-a29ae4645e05	/jobs/74168a8c-e4aa-4e6a-88b0-a29ae4645e05	2026-08-26 20:13:14.26198+00
22303986-5222-44c1-96cd-5feed35931fd	G9X39IFETZ4700EIUE237WI9LI16DH7JTKKUOW7SFQM9RIT8F6KJKVCB	new_message	Notification: Message	You have a new update regarding Design a responsive UI for a decentralised job board.	t	d9d1a321-9802-4515-ab3b-0d82a7c33e12	/jobs/d9d1a321-9802-4515-ab3b-0d82a7c33e12	2026-08-26 20:13:14.26198+00
a599ed25-00fb-446a-aef0-38e228971c93	GT4PZT3EDK2043NVJUUWZIX69GUP3HR2PJGDSY0PKUUMK5635T5BFZ63	escrow_released	Alert: Message	You have a new update regarding Create a Rust service that indexes Horizon API events.	f	542fd826-c128-494a-ae70-d8d0ff8ab92f	/jobs/542fd826-c128-494a-ae70-d8d0ff8ab92f	2026-08-26 20:13:14.26198+00
585c09a2-eb8f-47c7-9d5e-8127103a24de	GT4PZT3EDK2043NVJUUWZIX69GUP3HR2PJGDSY0PKUUMK5635T5BFZ63	new_message	Alert: Message	You have a new update regarding Create a CDN invalidation microservice.	f	fad32b56-3761-41ba-b671-964232d2cade	/jobs/fad32b56-3761-41ba-b671-964232d2cade	2026-08-26 20:13:14.26198+00
70792003-5f35-4618-8af8-64d83935b4a3	GT4PZT3EDK2043NVJUUWZIX69GUP3HR2PJGDSY0PKUUMK5635T5BFZ63	new_message	Update: Message	You have a new update regarding Design a responsive UI for a decentralised job board.	f	9a4bcb03-e3d7-4f0d-873e-74b09d248097	/jobs/9a4bcb03-e3d7-4f0d-873e-74b09d248097	2026-08-26 20:13:14.26198+00
f27dcbe0-c4be-4619-b589-b945d17cb477	GQXZXCZD9MX9SEY629RHIGZXV9XJM6Z6CCCIV473J6IUUKZTV6685T4B	escrow_released	Update: Payment	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	t	9d5b219d-7605-4b8e-8a0d-fabadbd58014	/jobs/9d5b219d-7605-4b8e-8a0d-fabadbd58014	2026-08-26 20:13:14.26198+00
2d056da7-2189-4bfe-851d-8b49de8d4c2b	GQXZXCZD9MX9SEY629RHIGZXV9XJM6Z6CCCIV473J6IUUKZTV6685T4B	escrow_released	Notification: Message	You have a new update regarding Design a responsive UI for a decentralised job board.	t	4c8bd166-dffc-4575-9c78-70031530c30e	/jobs/4c8bd166-dffc-4575-9c78-70031530c30e	2026-08-26 20:13:14.26198+00
79ad8cc7-5243-4712-90ec-8bf6e358e43c	G4K7YJPCHMB2U0J0N064DI7N9U47YUL38V8WQ4MPR9TOTSN5U4W9RSH8	new_message	Notification: Payment	You have a new update regarding Migrate a legacy Express API to TypeScript.	t	97e76a83-56be-438d-8980-0b021aa4ac82	/jobs/97e76a83-56be-438d-8980-0b021aa4ac82	2026-08-26 20:13:14.26198+00
37be4f68-09fb-458f-926a-1ef70ceabf1f	G4K7YJPCHMB2U0J0N064DI7N9U47YUL38V8WQ4MPR9TOTSN5U4W9RSH8	rating_received	Alert: Message	You have a new update regarding Design a responsive UI for a decentralised job board.	f	4c8bd166-dffc-4575-9c78-70031530c30e	/jobs/4c8bd166-dffc-4575-9c78-70031530c30e	2026-08-26 20:13:14.26198+00
5f95614d-424b-40f8-b195-27a7102fc804	G4K7YJPCHMB2U0J0N064DI7N9U47YUL38V8WQ4MPR9TOTSN5U4W9RSH8	application_received	Update: Job	You have a new update regarding Set up Kubernetes blue-green deployment for Node.js API.	f	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	/jobs/d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	2026-08-26 20:13:14.26198+00
d8faf5bf-4c12-406a-af86-0c4d27d77f00	GNM8R9RIGPPD7OODG0V4GIA9K044MSUSDFO8CL0LCZ5LSCATGVS3875I	new_message	Update: Payment	You have a new update regarding Build a Soroban escrow contract for freelance payments.	f	33900b8b-00fd-429d-8731-00631a2a2e2e	/jobs/33900b8b-00fd-429d-8731-00631a2a2e2e	2026-08-26 20:13:14.26198+00
408038df-273c-4ff0-b484-d1a651186aca	GNM8R9RIGPPD7OODG0V4GIA9K044MSUSDFO8CL0LCZ5LSCATGVS3875I	job_completed	Notification: Payment	You have a new update regarding Build a real-time notification service with WebSockets.	f	57192032-1abb-4169-9d39-bdb57a9b428f	/jobs/57192032-1abb-4169-9d39-bdb57a9b428f	2026-08-26 20:13:14.26198+00
d8ffdac4-5602-4846-bc65-747629e4c551	GNM8R9RIGPPD7OODG0V4GIA9K044MSUSDFO8CL0LCZ5LSCATGVS3875I	application_received	Update: Payment	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	f	47dfd2a5-c4f1-4e70-adbe-d8577df19b91	/jobs/47dfd2a5-c4f1-4e70-adbe-d8577df19b91	2026-08-26 20:13:14.26198+00
a6872803-a449-41f7-8fd8-b0e1749ada7d	GNM8R9RIGPPD7OODG0V4GIA9K044MSUSDFO8CL0LCZ5LSCATGVS3875I	rating_received	Notification: Message	You have a new update regarding Design a responsive UI for a decentralised job board.	f	d9d1a321-9802-4515-ab3b-0d82a7c33e12	/jobs/d9d1a321-9802-4515-ab3b-0d82a7c33e12	2026-08-26 20:13:14.26198+00
74d644d4-7581-48ec-a755-42a5dcb34442	GMLZ16UFZGLI4UPAQYP2RVTAQXPDH3TKZ6THSXOOI4J3X0948NPF727X	job_completed	Alert: Job	You have a new update regarding Build a real-time notification service with WebSockets.	f	57192032-1abb-4169-9d39-bdb57a9b428f	/jobs/57192032-1abb-4169-9d39-bdb57a9b428f	2026-08-26 20:13:14.26198+00
6ad71db4-5377-48d3-ad71-87eb7b17f35b	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	job_completed	Alert: Message	You have a new update regarding Build a Soroban escrow contract for freelance payments.	t	a2b96648-2ef9-4f5e-a313-346b9f8db3ab	/jobs/a2b96648-2ef9-4f5e-a313-346b9f8db3ab	2026-08-26 20:13:14.26198+00
e8d8fe5d-a881-4ee7-82a8-8b274eb518d7	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	application_received	Notification: Job	You have a new update regarding Build a Soroban escrow contract for freelance payments.	f	46655f7b-1ae1-417c-be78-44f9e68055d4	/jobs/46655f7b-1ae1-417c-be78-44f9e68055d4	2026-08-26 20:13:14.26198+00
0f0f239d-2496-43c8-b9f5-8e743553040f	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	rating_received	Alert: Message	You have a new update regarding Build a Soroban escrow contract for freelance payments.	f	33900b8b-00fd-429d-8731-00631a2a2e2e	/jobs/33900b8b-00fd-429d-8731-00631a2a2e2e	2026-08-26 20:13:14.26198+00
68157c66-bb65-434b-8333-9bae47f58958	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	job_completed	Update: Payment	You have a new update regarding Design a responsive UI for a decentralised job board.	f	9a4bcb03-e3d7-4f0d-873e-74b09d248097	/jobs/9a4bcb03-e3d7-4f0d-873e-74b09d248097	2026-08-26 20:13:14.26198+00
a1419c0d-569e-49ad-9544-3ad561e22a68	G0BPNEGC2DPCZ2O8NDI6SOUUPTJ7O0TRD9L195DWY7U00JTYL84POTJ3	job_completed	Update: Message	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	f	9d5b219d-7605-4b8e-8a0d-fabadbd58014	/jobs/9d5b219d-7605-4b8e-8a0d-fabadbd58014	2026-08-26 20:13:14.26198+00
4733752d-eded-4dbf-97d5-10c0a8c48b8d	G0BPNEGC2DPCZ2O8NDI6SOUUPTJ7O0TRD9L195DWY7U00JTYL84POTJ3	new_message	Notification: Message	You have a new update regarding Design an admin dashboard for dispute resolution.	t	27efcb05-6c80-4111-b603-f64c46caaaf1	/jobs/27efcb05-6c80-4111-b603-f64c46caaaf1	2026-08-26 20:13:14.26198+00
5fafb9e1-6cd6-465c-a13e-2999ddbb672f	G0BPNEGC2DPCZ2O8NDI6SOUUPTJ7O0TRD9L195DWY7U00JTYL84POTJ3	escrow_released	Alert: Payment	You have a new update regarding Design a responsive UI for a decentralised job board.	t	d9d1a321-9802-4515-ab3b-0d82a7c33e12	/jobs/d9d1a321-9802-4515-ab3b-0d82a7c33e12	2026-08-26 20:13:14.26198+00
aec86932-667d-49e0-a011-e77ddd767e9f	GXF8MDRYCEM9N4NVTANMH4PNZP9USY38WTQX653G4UNXU0COJBQ90SJM	new_message	Notification: Message	You have a new update regarding Set up Kubernetes blue-green deployment for Node.js API.	f	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	/jobs/d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	2026-08-26 20:13:14.26198+00
3d67c8e3-c4b2-4457-ba39-caefdd217f1f	GXF8MDRYCEM9N4NVTANMH4PNZP9USY38WTQX653G4UNXU0COJBQ90SJM	rating_received	Update: Payment	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	f	47dfd2a5-c4f1-4e70-adbe-d8577df19b91	/jobs/47dfd2a5-c4f1-4e70-adbe-d8577df19b91	2026-08-26 20:13:14.26198+00
5dffca03-e449-4037-82ec-43d1aaf9e8ac	GI85L8D7CEDA0IOEJAN63XD45BA890AB7R8SB61LGG7JPM7QWRZFXZ3P	new_message	Update: Payment	You have a new update regarding Build a Soroban escrow contract for freelance payments.	f	33900b8b-00fd-429d-8731-00631a2a2e2e	/jobs/33900b8b-00fd-429d-8731-00631a2a2e2e	2026-08-26 20:13:14.26198+00
dacb7644-f162-48c3-8cb0-78eec2062ae2	GKF51VG7CON4RCER8CLUBNJZETKPY8VYIF6WDG1OEVZUBR25OW9Y1LYF	escrow_released	Alert: Message	You have a new update regarding Build a real-time notification service with WebSockets.	t	57192032-1abb-4169-9d39-bdb57a9b428f	/jobs/57192032-1abb-4169-9d39-bdb57a9b428f	2026-08-26 20:13:14.26198+00
41f5796d-9260-456a-adbf-9decb427bb5d	GKF51VG7CON4RCER8CLUBNJZETKPY8VYIF6WDG1OEVZUBR25OW9Y1LYF	rating_received	Update: Payment	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	t	9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	/jobs/9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	2026-08-26 20:13:14.26198+00
00a206af-66f0-47b8-b088-9bd30e913518	GKF51VG7CON4RCER8CLUBNJZETKPY8VYIF6WDG1OEVZUBR25OW9Y1LYF	job_completed	Alert: Job	You have a new update regarding Build a Soroban escrow contract for freelance payments.	f	46655f7b-1ae1-417c-be78-44f9e68055d4	/jobs/46655f7b-1ae1-417c-be78-44f9e68055d4	2026-08-26 20:13:14.26198+00
3d827fce-b037-414d-a524-383d5e3ac77b	GKF51VG7CON4RCER8CLUBNJZETKPY8VYIF6WDG1OEVZUBR25OW9Y1LYF	job_completed	Update: Payment	You have a new update regarding Develop a mobile app for Stellar wallet onboarding.	f	74168a8c-e4aa-4e6a-88b0-a29ae4645e05	/jobs/74168a8c-e4aa-4e6a-88b0-a29ae4645e05	2026-08-26 20:13:14.26198+00
710d27fe-4eed-44d1-8c56-30d58f8de911	GKF51VG7CON4RCER8CLUBNJZETKPY8VYIF6WDG1OEVZUBR25OW9Y1LYF	new_message	Notification: Payment	You have a new update regarding Design a responsive UI for a decentralised job board.	t	d9d1a321-9802-4515-ab3b-0d82a7c33e12	/jobs/d9d1a321-9802-4515-ab3b-0d82a7c33e12	2026-08-26 20:13:14.26198+00
a664c125-e762-475d-b35d-ba65519689f2	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	job_completed	Alert: Payment	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	f	9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	/jobs/9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	2026-08-26 20:13:14.26198+00
94ac0ec4-08e4-4f17-aa59-f9f12bfd1c11	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	rating_received	Alert: Payment	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	f	9d5b219d-7605-4b8e-8a0d-fabadbd58014	/jobs/9d5b219d-7605-4b8e-8a0d-fabadbd58014	2026-08-26 20:13:14.26198+00
c19dfdfe-3b43-4335-843d-9937d6a587df	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	new_message	Alert: Message	You have a new update regarding Design a responsive UI for a decentralised job board.	t	9a4bcb03-e3d7-4f0d-873e-74b09d248097	/jobs/9a4bcb03-e3d7-4f0d-873e-74b09d248097	2026-08-26 20:13:14.26198+00
5a606c85-e23d-4846-bca3-8d69dd6fb45e	GVYV2V1ITUM4ULZUS5PUYRZXHM8L9B3N2SE05ITPQJ1YE24Z8608CX8F	application_received	Update: Job	You have a new update regarding Design an admin dashboard for dispute resolution.	f	aed25e1a-56d0-41de-95d3-3f87f58211df	/jobs/aed25e1a-56d0-41de-95d3-3f87f58211df	2026-08-26 20:13:14.26198+00
66d7626f-81ed-4671-9564-ad99aac468df	GVYV2V1ITUM4ULZUS5PUYRZXHM8L9B3N2SE05ITPQJ1YE24Z8608CX8F	job_completed	Notification: Job	You have a new update regarding Migrate a legacy Express API to TypeScript.	f	97e76a83-56be-438d-8980-0b021aa4ac82	/jobs/97e76a83-56be-438d-8980-0b021aa4ac82	2026-08-26 20:13:14.26198+00
14249067-0468-4b67-bc28-ebe1aae202f4	GVYV2V1ITUM4ULZUS5PUYRZXHM8L9B3N2SE05ITPQJ1YE24Z8608CX8F	new_message	Alert: Payment	You have a new update regarding Build a Soroban escrow contract for freelance payments.	t	46655f7b-1ae1-417c-be78-44f9e68055d4	/jobs/46655f7b-1ae1-417c-be78-44f9e68055d4	2026-08-26 20:13:14.26198+00
8210e844-d382-4b66-ba8a-9a6b2e2c1842	GVYV2V1ITUM4ULZUS5PUYRZXHM8L9B3N2SE05ITPQJ1YE24Z8608CX8F	escrow_released	Alert: Payment	You have a new update regarding Build a Soroban escrow contract for freelance payments.	t	33900b8b-00fd-429d-8731-00631a2a2e2e	/jobs/33900b8b-00fd-429d-8731-00631a2a2e2e	2026-08-26 20:13:14.26198+00
8278afb1-537b-4921-a5eb-8704315ae33d	GVYV2V1ITUM4ULZUS5PUYRZXHM8L9B3N2SE05ITPQJ1YE24Z8608CX8F	job_completed	Update: Message	You have a new update regarding Design a responsive UI for a decentralised job board.	t	4c8bd166-dffc-4575-9c78-70031530c30e	/jobs/4c8bd166-dffc-4575-9c78-70031530c30e	2026-08-26 20:13:14.26198+00
d21e494f-b433-4003-8d45-b039770ce690	GGQO679O2XZ36JWB4GS0FHJWTV3N74W4G22UETCHBVGKP7L9KV913OZL	rating_received	Alert: Job	You have a new update regarding Design a responsive UI for a decentralised job board.	t	9a4bcb03-e3d7-4f0d-873e-74b09d248097	/jobs/9a4bcb03-e3d7-4f0d-873e-74b09d248097	2026-08-26 20:13:14.26198+00
59b3df7e-1009-4174-b783-62c62453c680	G1YANNREG8LXUM3HQ57UYZHWW3LTFIUHPTHLXJ6Y0IY1L58L9K5SILU2	application_received	Notification: Message	You have a new update regarding Build a Soroban escrow contract for freelance payments.	t	249e0244-7263-4347-9003-c40eeeadb1e9	/jobs/249e0244-7263-4347-9003-c40eeeadb1e9	2026-08-26 20:13:14.26198+00
7a6fce5a-1925-4a6a-a5ad-7026ffd86004	G1YANNREG8LXUM3HQ57UYZHWW3LTFIUHPTHLXJ6Y0IY1L58L9K5SILU2	job_completed	Notification: Job	You have a new update regarding Design a responsive UI for a decentralised job board.	f	4c8bd166-dffc-4575-9c78-70031530c30e	/jobs/4c8bd166-dffc-4575-9c78-70031530c30e	2026-08-26 20:13:14.26198+00
8e4482d3-a84b-439b-8699-88251015a02c	G1YANNREG8LXUM3HQ57UYZHWW3LTFIUHPTHLXJ6Y0IY1L58L9K5SILU2	job_completed	Update: Message	You have a new update regarding Design a responsive UI for a decentralised job board.	t	d9d1a321-9802-4515-ab3b-0d82a7c33e12	/jobs/d9d1a321-9802-4515-ab3b-0d82a7c33e12	2026-08-26 20:13:14.26198+00
d5a4894e-fad4-4e69-a70e-ddcef0f39f96	G1YANNREG8LXUM3HQ57UYZHWW3LTFIUHPTHLXJ6Y0IY1L58L9K5SILU2	new_message	Update: Message	You have a new update regarding Build a Soroban escrow contract for freelance payments.	t	a2b96648-2ef9-4f5e-a313-346b9f8db3ab	/jobs/a2b96648-2ef9-4f5e-a313-346b9f8db3ab	2026-08-26 20:13:14.26198+00
4c07ee40-9530-44e6-8235-d319b76d8bd2	G1YANNREG8LXUM3HQ57UYZHWW3LTFIUHPTHLXJ6Y0IY1L58L9K5SILU2	job_completed	Notification: Job	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	f	9d5b219d-7605-4b8e-8a0d-fabadbd58014	/jobs/9d5b219d-7605-4b8e-8a0d-fabadbd58014	2026-08-26 20:13:14.26198+00
30562b41-c358-4c8a-8346-d20a37055830	GKFBOSCRO8SK3596HHR8X8C28N1GPTC2QWF2HPNW1KINNDW8R8KUSSR6	job_completed	Update: Message	You have a new update regarding Design an admin dashboard for dispute resolution.	t	aed25e1a-56d0-41de-95d3-3f87f58211df	/jobs/aed25e1a-56d0-41de-95d3-3f87f58211df	2026-08-26 20:13:14.26198+00
d68e2d96-236d-41d3-9617-f9a34f87aac6	GKFBOSCRO8SK3596HHR8X8C28N1GPTC2QWF2HPNW1KINNDW8R8KUSSR6	job_completed	Alert: Payment	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	t	9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	/jobs/9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	2026-08-26 20:13:14.26198+00
7848dc3f-fcbd-447b-a83a-fd5ec7919a65	GKFBOSCRO8SK3596HHR8X8C28N1GPTC2QWF2HPNW1KINNDW8R8KUSSR6	job_completed	Update: Message	You have a new update regarding Write end-to-end Playwright tests for checkout flow.	f	db8441d7-dcfe-4221-b09a-99e5242110e0	/jobs/db8441d7-dcfe-4221-b09a-99e5242110e0	2026-08-26 20:13:14.26198+00
f8c74d9e-0aad-46ad-8442-51cea5992284	GKFBOSCRO8SK3596HHR8X8C28N1GPTC2QWF2HPNW1KINNDW8R8KUSSR6	new_message	Update: Job	You have a new update regarding Create a Rust service that indexes Horizon API events.	t	542fd826-c128-494a-ae70-d8d0ff8ab92f	/jobs/542fd826-c128-494a-ae70-d8d0ff8ab92f	2026-08-26 20:13:14.26198+00
95653202-e024-4000-a7c9-f3b88ade043e	GUPZ5JR0Y2EFZ6RX35UAF3WE8ZN1N5RUSV9I5VDCG3BHK23A1MITKRFX	new_message	Notification: Payment	You have a new update regarding Build a Soroban escrow contract for freelance payments.	t	249e0244-7263-4347-9003-c40eeeadb1e9	/jobs/249e0244-7263-4347-9003-c40eeeadb1e9	2026-08-26 20:13:14.26198+00
0d4e9ecf-94c1-4612-83dc-5e2bd0548289	GUPZ5JR0Y2EFZ6RX35UAF3WE8ZN1N5RUSV9I5VDCG3BHK23A1MITKRFX	application_received	Update: Message	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	f	9d5b219d-7605-4b8e-8a0d-fabadbd58014	/jobs/9d5b219d-7605-4b8e-8a0d-fabadbd58014	2026-08-26 20:13:14.26198+00
eb509202-7be0-4d0a-96e2-0effab0bb2c3	GUPZ5JR0Y2EFZ6RX35UAF3WE8ZN1N5RUSV9I5VDCG3BHK23A1MITKRFX	application_received	Notification: Message	You have a new update regarding Design an admin dashboard for dispute resolution.	f	aed25e1a-56d0-41de-95d3-3f87f58211df	/jobs/aed25e1a-56d0-41de-95d3-3f87f58211df	2026-08-26 20:13:14.26198+00
c65624ae-a660-4014-899e-e93adbb08ce2	GUPZ5JR0Y2EFZ6RX35UAF3WE8ZN1N5RUSV9I5VDCG3BHK23A1MITKRFX	new_message	Alert: Message	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	t	9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	/jobs/9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	2026-08-26 20:13:14.26198+00
9e1ffaf1-c50f-4fc7-89e7-7b6916c9d1c7	GUPZ5JR0Y2EFZ6RX35UAF3WE8ZN1N5RUSV9I5VDCG3BHK23A1MITKRFX	new_message	Notification: Job	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	f	9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	/jobs/9c55d6d0-0257-47dd-b7f2-1c1344fec5b7	2026-08-26 20:13:14.26198+00
8a570ddc-f3d0-489f-ae8f-12d75743b327	GFGAN4EIO72AAVH1I4EOYFGGUXTIYIJE7AK2WNJ02NFGIHYW1UIPRFP9	job_completed	Update: Job	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	t	47dfd2a5-c4f1-4e70-adbe-d8577df19b91	/jobs/47dfd2a5-c4f1-4e70-adbe-d8577df19b91	2026-08-26 20:13:14.26198+00
fc9080c3-6f07-4443-85cf-11d572b40351	GFGAN4EIO72AAVH1I4EOYFGGUXTIYIJE7AK2WNJ02NFGIHYW1UIPRFP9	rating_received	Update: Job	You have a new update regarding Build a Soroban escrow contract for freelance payments.	f	a2b96648-2ef9-4f5e-a313-346b9f8db3ab	/jobs/a2b96648-2ef9-4f5e-a313-346b9f8db3ab	2026-08-26 20:13:14.26198+00
5165b5bd-6cd2-4717-a58a-43650eaacc14	GFGAN4EIO72AAVH1I4EOYFGGUXTIYIJE7AK2WNJ02NFGIHYW1UIPRFP9	application_received	Alert: Job	You have a new update regarding Develop a Next.js marketplace frontend with wallet connect.	f	47dfd2a5-c4f1-4e70-adbe-d8577df19b91	/jobs/47dfd2a5-c4f1-4e70-adbe-d8577df19b91	2026-08-26 20:13:14.26198+00
7668889f-fc4f-4dd6-ac9d-adecff119ac6	G5YHP5E7AXUIY0X8L4EBEAQNCDZ6S601ZF88JRFTF6NJ8UZET1PDPF1H	new_message	Update: Message	You have a new update regarding Develop a mobile app for Stellar wallet onboarding.	t	74168a8c-e4aa-4e6a-88b0-a29ae4645e05	/jobs/74168a8c-e4aa-4e6a-88b0-a29ae4645e05	2026-08-26 20:13:14.26198+00
449b3299-6c8b-4f7c-af94-c3db947e1749	G5YHP5E7AXUIY0X8L4EBEAQNCDZ6S601ZF88JRFTF6NJ8UZET1PDPF1H	rating_received	Update: Payment	You have a new update regarding Write end-to-end Playwright tests for checkout flow.	t	db8441d7-dcfe-4221-b09a-99e5242110e0	/jobs/db8441d7-dcfe-4221-b09a-99e5242110e0	2026-08-26 20:13:14.26198+00
06cd6649-a36a-4301-9ba1-f5d78d005677	G5YHP5E7AXUIY0X8L4EBEAQNCDZ6S601ZF88JRFTF6NJ8UZET1PDPF1H	application_received	Update: Job	You have a new update regarding Build a Soroban escrow contract for freelance payments.	f	249e0244-7263-4347-9003-c40eeeadb1e9	/jobs/249e0244-7263-4347-9003-c40eeeadb1e9	2026-08-26 20:13:14.26198+00
ea9e8c08-3b73-444f-a9e7-bc622396d157	GAK5W77QKXIRHBV1R7EQE536XD5KXKQGHO6ACAPC4XYJLC90OUP0UREX	new_message	Alert: Message	You have a new update regarding Create a CDN invalidation microservice.	f	fad32b56-3761-41ba-b671-964232d2cade	/jobs/fad32b56-3761-41ba-b671-964232d2cade	2026-08-26 20:13:14.26198+00
e6be3c6e-d75f-4baf-a4a4-f55d087a817d	GAK5W77QKXIRHBV1R7EQE536XD5KXKQGHO6ACAPC4XYJLC90OUP0UREX	escrow_released	Update: Job	You have a new update regarding Develop a mobile app for Stellar wallet onboarding.	f	74168a8c-e4aa-4e6a-88b0-a29ae4645e05	/jobs/74168a8c-e4aa-4e6a-88b0-a29ae4645e05	2026-08-26 20:13:14.26198+00
68aba713-2ea7-4956-8bbd-7d76893caf0b	GXMSTP3X5M8PJA0BO8WAVAYTGN7P05DJRFCO70X3FG6IZED1IPSQUZUU	application_received	Alert: Job	You have a new update regarding Build a real-time notification service with WebSockets.	f	57192032-1abb-4169-9d39-bdb57a9b428f	/jobs/57192032-1abb-4169-9d39-bdb57a9b428f	2026-08-26 20:13:14.26198+00
b405b16d-df80-4e9f-969a-5adca90847fa	GK23U0H8WN2T3QHFKTCNUJFPWZ6DTQLBZ299PG3GIHADOIMZXFQEBEM2	new_message	Alert: Payment	You have a new update regarding Build a Soroban escrow contract for freelance payments.	t	46655f7b-1ae1-417c-be78-44f9e68055d4	/jobs/46655f7b-1ae1-417c-be78-44f9e68055d4	2026-08-26 20:13:14.26198+00
e21f4a01-bdec-4ddd-a6df-dde3c580e23e	G1Z5BY1LWNLRR2JCPS5094DFRYI0M7P8BYW485W6UYRLBUOBRD47WOKG	application_received	Notification: Job	You have a new update regarding Set up Kubernetes blue-green deployment for Node.js API.	t	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	/jobs/d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	2026-08-26 20:13:14.26198+00
340b1190-4ad7-450e-bcad-a85e320f1e52	G1Z5BY1LWNLRR2JCPS5094DFRYI0M7P8BYW485W6UYRLBUOBRD47WOKG	application_received	Update: Message	You have a new update regarding Migrate a legacy Express API to TypeScript.	f	97e76a83-56be-438d-8980-0b021aa4ac82	/jobs/97e76a83-56be-438d-8980-0b021aa4ac82	2026-08-26 20:13:14.26198+00
45d1af77-63e5-43df-909e-55a086b08a53	GLLPUWBWJM58TL5CFDOOB74AVMIVLUDBJJH7XEXZGVTUIK15UL9WOLYT	new_message	Update: Payment	You have a new update regarding Build a Soroban escrow contract for freelance payments.	t	46655f7b-1ae1-417c-be78-44f9e68055d4	/jobs/46655f7b-1ae1-417c-be78-44f9e68055d4	2026-08-26 20:13:14.26198+00
8526dcef-28c8-42eb-b8b1-55c0fbd85dd4	GLLPUWBWJM58TL5CFDOOB74AVMIVLUDBJJH7XEXZGVTUIK15UL9WOLYT	new_message	Notification: Message	You have a new update regarding Create a CDN invalidation microservice.	t	fad32b56-3761-41ba-b671-964232d2cade	/jobs/fad32b56-3761-41ba-b671-964232d2cade	2026-08-26 20:13:14.26198+00
5e281ef6-f7d9-4a87-9128-66390d4e8c1c	GLLPUWBWJM58TL5CFDOOB74AVMIVLUDBJJH7XEXZGVTUIK15UL9WOLYT	rating_received	Notification: Payment	You have a new update regarding Create a Rust service that indexes Horizon API events.	t	542fd826-c128-494a-ae70-d8d0ff8ab92f	/jobs/542fd826-c128-494a-ae70-d8d0ff8ab92f	2026-08-26 20:13:14.26198+00
f6bc0e21-1545-4c07-aa7e-f866f8120151	GLLPUWBWJM58TL5CFDOOB74AVMIVLUDBJJH7XEXZGVTUIK15UL9WOLYT	new_message	Alert: Payment	You have a new update regarding Build a real-time notification service with WebSockets.	t	57192032-1abb-4169-9d39-bdb57a9b428f	/jobs/57192032-1abb-4169-9d39-bdb57a9b428f	2026-08-26 20:13:14.26198+00
\.


--
-- Data for Name: oracle_proofs; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.oracle_proofs (id, claim_id, oracle_address, proof_data, proof_type, verified, verification_error, created_at, verified_at) FROM stdin;
\.


--
-- Data for Name: platform_fee_payouts; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.platform_fee_payouts (id, job_id, freelancer_address, recipient_address, recipient_type, amount_xlm, contract_tx_hash, created_at) FROM stdin;
\.


--
-- Data for Name: private_messages; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.private_messages (id, sender_address, recipient_address, sender_public_key, recipient_public_key, nonce, cipher_text, created_at) FROM stdin;
529c5c7f-1697-4e47-be05-e305210d61a8	GG73AJ0JE4QVZFV8YU58CEPSOF1GG2KTBCUDSWX1JP70LKLFYP5JO3Q3	GK23U0H8WN2T3QHFKTCNUJFPWZ6DTQLBZ299PG3GIHADOIMZXFQEBEM2	G9YP6SDYY0U9DAQM2OX8MMS2LELL6HYC1R9QIKQAV3JCJUDT59WEU7OL	G7E6K088ZFWONVVXSN749AHW2PPCUYHYQ8SB7X6625CSMU6FGK88AENN	13993ccc5a03bf1cf1014ede72e4209229f1f8274ff858d49b024ca3b2885529	ENCRYPTED:884e65a9057adc93249e03a2b8db5242	2026-08-22 00:22:13.761914+00
eb7fbc3b-b7e3-41e2-b07c-3f0d48cd4898	GG1WU16HYMQC1A78MX1EVUHT6T0UZS9IM0YLTZ9ATSN1U322N64KFS6V	GKT9A90FOH3HJ5S6R044P39JYM6IER0V6RAST5J284WV98Y3UMPYO0CU	G81EJB3VCFEDLQ9EOQ0Y2Z1UBYH8AECEW6GSTFS2YZB4K8OIZ8SJTXA9	G9JHCAZ89FTNWN06JKLOQMHLD939ESEQGM5VWIPGSEMU52VTJXU1KAUP	95d655f6a652bce1c5a4a379e37d88691370159deb7ca2d5b5ad25b6ffc5b142	ENCRYPTED:8445a7ca4daa612bf90e2b73a2ef4fea	2026-08-24 07:43:13.76196+00
ad904718-7b79-4d80-8a90-8e994c860cf7	GAK5W77QKXIRHBV1R7EQE536XD5KXKQGHO6ACAPC4XYJLC90OUP0UREX	GK23U0H8WN2T3QHFKTCNUJFPWZ6DTQLBZ299PG3GIHADOIMZXFQEBEM2	G1RXIV432WT59GLFRI8MQEEB6BZNC9Q884JXZOSI366FZX6APK6I2KLJ	G4WCO5OEQXOCN7XY43CCUG7RQ8LYYXE7QYO7ZWW54A6I2KOE6RNJLKXH	b1ff076ea7dfdc60ad16b3928329fb4768f91b3c530584c693b6f0ab48c80836	ENCRYPTED:0cb51afad9e8888db8da23764c514056	2026-08-24 05:19:13.761988+00
985500d4-8885-4742-8ec2-13b64f161c49	G9X39IFETZ4700EIUE237WI9LI16DH7JTKKUOW7SFQM9RIT8F6KJKVCB	GMU46JD2GVF6LCP2277KXXSY0VDVEVG9YSQJVFJWTZIFT9YVI7F16XBX	GH444NK0BPCIKI6CJDKQL7ZBSFN244KO0JL6QKV3EOYYIGBM760JGL4C	G86HF4I8A170XC71O4YWG1IQ4OFS80QMAA7H7AYNU0XGJ1QQ81XRZN09	40af1bf9cdabfe10e1962f5b04c2f5cb65a9fff3c1fa2de29ea8111cdd3bbcf1	ENCRYPTED:583cae1fbc50427c88e80a4246a4774f	2026-08-20 11:57:13.762013+00
94f6b582-225d-4ff7-96a8-a581b64dffed	GNM8R9RIGPPD7OODG0V4GIA9K044MSUSDFO8CL0LCZ5LSCATGVS3875I	GEZ5EDJJTFPH90O7Y22T1TDGNNQFKPL9EKA024SCOSS3EOQM1H8OJRJE	GX994QTWZIHO2KGN6ZV9DKYAFJ41FEQOXFCYZ7SDL52AM7SMC67OKCXP	GAKFRZWZZM7AEF9S9WWROM3ZAQL06G9E6SVH6Q8Q2Y4PV33B4HQEYOOU	f2d92c49dfc614aedf4757b91a186ee1f4e1ee30ab8fcd42b6c8a495226d3123	ENCRYPTED:164b67b4e2cf70df7e7dd08fc1a99bcf	2026-08-22 03:35:13.762041+00
2e740704-35e6-44d3-93e3-046c1fff8b30	G87CVIYJKLK2C0XP2S2O8PT4MX23SY670KMIQD4X9G7HSFKR26J1FO2W	G0BPNEGC2DPCZ2O8NDI6SOUUPTJ7O0TRD9L195DWY7U00JTYL84POTJ3	G8AQPSFZVE9L4UWNRLM5MPPQNOMPWJGHF5A8C4XU5R5L6RZOID7148C6	GWZL3H73UAANYGUXQL9QPR4VXL51N0XXZR2LIOGRP91YMJJ4AL05I78U	9b9c6a2939bc51260f14ac752c6d4dde45d4835383a9568ee1c27211945fbdcd	ENCRYPTED:240d38f074bad994b95d97f7cfd688a4	2026-08-21 07:20:13.762064+00
ea9a61a9-12eb-4694-a7a8-8fefc84dfd4a	G03VKXTUFDJKDFR21520RN6HW1HS57TCOZDANTNIQSUHA51LIY8O69WE	GYXGO4B9UOE3T0HICCT5HGP8IY3X80J0G50RCXN22PXGX8WDZRMH3FNB	G9DZGKDNQ4G2VQXX99QWB0HWM8LSWU652FYS3JKV0ZEFKVOUUSRZR2X7	G20KLBIPQFNKZGGE49DBZ7FGQJFYTOPS2II7KBCWU438R92I8L3178TW	eb62ab0783441b201eb1f22dee031fb8ca5d21111e4c27faa732eec87bc8789e	ENCRYPTED:09c7fe1754854fa114a7b6772108a6a4	2026-08-21 08:41:13.762087+00
4e4033da-4733-4c7b-84fe-cc2c130b342c	GXF8MDRYCEM9N4NVTANMH4PNZP9USY38WTQX653G4UNXU0COJBQ90SJM	GG73AJ0JE4QVZFV8YU58CEPSOF1GG2KTBCUDSWX1JP70LKLFYP5JO3Q3	GF2TX0QJTAA7IWS48A54TA1SOA9XM091ZPKYYOQF1P7RS8R0MELISH32	GR5MUBJD8BLGSRI2AOFJA5NV0T5X3CVFJDRZE84LMQYAHPY2PCM3G7N4	47edb7e10192e1831667be28f27cde37aaa5926b6f7e849f5980fb0e034da7da	ENCRYPTED:9c366930c8c7b0be1307a913cea2aec4	2026-08-22 09:57:13.76211+00
1c020181-1374-4272-8f2b-45d698ac9003	GFGAN4EIO72AAVH1I4EOYFGGUXTIYIJE7AK2WNJ02NFGIHYW1UIPRFP9	G03VKXTUFDJKDFR21520RN6HW1HS57TCOZDANTNIQSUHA51LIY8O69WE	GUKC97HQ4TMXDNHP1UAKRHZPAC4JXFPK5FVDDWJ8GI5OU9W2MBYWIQC5	G29S85ML8WU3R9KE7J2SQ8X3A6YLBXPUE8YM759JSU0UHG7ECILCMG5M	3d3154e29f7a3e8c7212f4807ca7b8f57528cbd87dccc85f3b616e4d0dd62971	ENCRYPTED:c9332f23fd875349aa757b38d29f64fa	2026-08-25 17:15:13.762132+00
e60d4f9e-30e3-49e8-af9d-3a0dab9d3252	GXK87AU5BHXTPDPFF5E8II49KQ71N8MTZX272HPOEVB9OOAEDOECVE6P	GKF51VG7CON4RCER8CLUBNJZETKPY8VYIF6WDG1OEVZUBR25OW9Y1LYF	GY57QDXOEAN5F3DX90XDR7CETEN7GGO8YMM7PL990GW31GKL9Z6VK82W	GU9UX01UP8NY9QX22ZACSB7ITATONUBR969JGC3WJIQXPOQTFZNEU4L5	fc30648c2d4e8b43460618bece34a33b620b67d268c6e4facbc7e7273671453c	ENCRYPTED:dbe2f1e1bd6e584f0def0184a535103b	2026-08-20 06:52:13.762159+00
0f7b947a-7835-461b-a8ad-6d1a7ffa44a1	GG1WU16HYMQC1A78MX1EVUHT6T0UZS9IM0YLTZ9ATSN1U322N64KFS6V	GVYV2V1ITUM4ULZUS5PUYRZXHM8L9B3N2SE05ITPQJ1YE24Z8608CX8F	GTCYFDVW10HOAYDT7CU8JU6OJDZ26FO1SZJIVF4D9ZQFZ61II49M5ZM9	G7PPER1UFH01XWMUWBTKW2J2COMXJFHDPJSAVHT24BVN8NN87Q94JBY7	f174e56b54cf5f48a1328e5ea010c8ec45bccf1b6691af86dcfa3bd2d5b485a8	ENCRYPTED:7e7aa2854cb68a25587dcd4a983c0196	2026-08-26 08:20:13.762182+00
417d38c2-7cb4-4d66-b8cc-e54c90abac0c	GYXGO4B9UOE3T0HICCT5HGP8IY3X80J0G50RCXN22PXGX8WDZRMH3FNB	G9P452BFSOZPTX497W19VW3RTQOHMUH8LMN4R7SGMSOXLTA8IRCD9SI5	GDSMRD3AEYRXGBSYOY6GU58FLM639BCP7TV5ZKBWWWTP6RDQYB9ROJVZ	GIFY7O0PJ1TV28INI8MIT7I1JKUE98HLUJBU00T2RJMGILBROOOBWF4I	96720b1913237c53516255be7fef0ed0e9b8373da48be9da865f7c8b9a4ecb53	ENCRYPTED:b3482849e9bf6f1de85325aa8225b634	2026-08-21 03:02:13.762206+00
c7c3f1bc-af27-4891-bd49-73b0a0231b57	GVYV2V1ITUM4ULZUS5PUYRZXHM8L9B3N2SE05ITPQJ1YE24Z8608CX8F	GNM8R9RIGPPD7OODG0V4GIA9K044MSUSDFO8CL0LCZ5LSCATGVS3875I	GXLY54IKMOC0AR0OMNEL25U3P1ZCYUZ87C7G23CP78ZC9Y7DMS2ZTS3K	G1SD7J32F6HL8IZ0U2BL3M3FQUKHFH2XF7Y6KY9YCKVJKJLD0TT2SLHI	d6b233ee73d073acf5a459c683f3e8a81447ee710f6cf71036faab9986591644	ENCRYPTED:50bdc197bc3e2828fadf237789a3b9b8	2026-08-24 12:49:13.762229+00
abc2d84d-5bc4-49de-a5a4-af4edae3bb73	G1CBFNO6B9M80O2RAK1VRJNVGFYGWWQC38HYF9SXMECOSFOGYR3XKXWN	GGQO679O2XZ36JWB4GS0FHJWTV3N74W4G22UETCHBVGKP7L9KV913OZL	GQA3558A5PN4302FAP9R9NDLJDWCJCTVFDG0LKS9L3XCFTUXYE19ES4I	GHRV707NNDG7F4S1UQ7WI5755LOSMAHB3HN00CVW9NAMSQETT69UAHVV	8d932569478e5dfaed50be863663394304bebd6349b725409c72361b41b69f13	ENCRYPTED:ea8ef24d8384645df1be400c5905c0c7	2026-08-22 08:04:13.762252+00
0358e6a3-3df6-4629-8716-99b4a085100e	GXMSTP3X5M8PJA0BO8WAVAYTGN7P05DJRFCO70X3FG6IZED1IPSQUZUU	GKF51VG7CON4RCER8CLUBNJZETKPY8VYIF6WDG1OEVZUBR25OW9Y1LYF	GBLMVV44CI4J38V30D7TU98BNVWEJRBVY8KYLHTUCR0F5PX2TN7TLHXC	GMF26B46JMV47TUJG7INC3Y7HATCFV3CG7TBTNUMMSR8U2HRJKRHA96G	31e65022d159de1230318ab293077bdf6484b63b0888b890a8d228e98af91f84	ENCRYPTED:65be125dab00808bd8ba9a7e92a865ac	2026-08-24 11:48:13.762275+00
302c88f5-3c3f-4e92-8b4f-163e986fdd73	GXF8MDRYCEM9N4NVTANMH4PNZP9USY38WTQX653G4UNXU0COJBQ90SJM	G87CVIYJKLK2C0XP2S2O8PT4MX23SY670KMIQD4X9G7HSFKR26J1FO2W	G9URJSPKETV82DIB4DGYDF1ZL2WTVM8F3IF3G3T34OOJQXZLVU35BE4H	GW43KSWI6GZGU9ET83Z0PP9K4YEVN11V8PLE5H3U9G2LTZEGYU5DFNIA	4785c62838e1caf8207bfb90f3933c87af7391883d357682559e93b3e3d97c01	ENCRYPTED:c0d6be404f8448887472260ba3a45d30	2026-08-25 04:09:13.762299+00
96cb008b-4fce-4247-8d9d-e9116eee2ca7	GUPZ5JR0Y2EFZ6RX35UAF3WE8ZN1N5RUSV9I5VDCG3BHK23A1MITKRFX	GHKTGBTYZMEPGTHCW81XE6VA05G1X3J1L7R8431RUPFR2P3YVB5UL5NW	G28SY2MNUTT1WFA6ZISDX9DA9WHSBP1ZUYZY18NL4IM9YX0JSIIAEBJ5	G1IFI031L36192YWOL1A5P6R08XCC4XH4FJ7R37F7FP4E8TDV8A4364V	7afeb0ad7aa7f78388e82bd67ac44ef19c4264af5e3111f42b000594ec2700ae	ENCRYPTED:91ba9a4a221ff052f1fde61ae7895f82	2026-08-22 01:15:13.762323+00
1e100fa0-2beb-4061-bd2d-33af2b73420f	G87CVIYJKLK2C0XP2S2O8PT4MX23SY670KMIQD4X9G7HSFKR26J1FO2W	G3Z0GU1UQXJ4EFFF1GXI9D99VH0W1DSTWG6NJ4OGW9XHRO199BRBLRTV	GSKCTQD4KDSBS5FI6ERQIRRQAHLJ2XLQP5L7CVFJJ50YP2KNWDQHDK3Z	G4T48OYY4QJ71AS2YU7CG8W1RVRRGQZ3PM7VLU9AAEA0G7G2WOSQMCBF	a52dd2fb4aec5b9a53775093cab29a895b22c29433c0f81194d5ade0a0412fe7	ENCRYPTED:74587d0b728858d2d2e93cf5e7c60b49	2026-08-26 04:41:13.762347+00
b77569eb-eb14-41e8-b64f-bd480e3b1483	GVYV2V1ITUM4ULZUS5PUYRZXHM8L9B3N2SE05ITPQJ1YE24Z8608CX8F	GUPZ5JR0Y2EFZ6RX35UAF3WE8ZN1N5RUSV9I5VDCG3BHK23A1MITKRFX	GNHHFIYLHLQS3E3R1UQKERDYYVDQQL2E5MZL5GJ81NG2QGCEEQ2B5JAC	GYRJVZA6541ZE8OAY4H8WVTZDFX8VF3SML9CYMTYGW5F2MICMBP5YE8T	6e946feb0dfc5e5510d80b3bfd13c38f8c8a386bc5f3a62546c49db06b54ed67	ENCRYPTED:540d796aab1b6b1a82d4107e678a33c4	2026-08-21 03:46:13.76237+00
422be4b7-cacc-4a32-8748-223f57955b75	GXF8MDRYCEM9N4NVTANMH4PNZP9USY38WTQX653G4UNXU0COJBQ90SJM	GQXZXCZD9MX9SEY629RHIGZXV9XJM6Z6CCCIV473J6IUUKZTV6685T4B	GBCVDVCZHN738JOECJ5B4CPIALDTG3KEGH5OEM1VZUH8IUNCLVEHRJ0K	GX9K2PCIGYKB5FAALFS04INJR720PLCL5FTW0A9PMH7GX86O3NRDMHJ4	1b55864cb04a137b21a2e1c053db9058e48e980df34be7a9dfbaed56ddd0f264	ENCRYPTED:cfb73380ff05661e8e66bf10d4b23580	2026-08-21 04:21:13.762394+00
87110818-deeb-4c55-aa3a-1662791fe176	GEZ5EDJJTFPH90O7Y22T1TDGNNQFKPL9EKA024SCOSS3EOQM1H8OJRJE	G9P452BFSOZPTX497W19VW3RTQOHMUH8LMN4R7SGMSOXLTA8IRCD9SI5	GCDXSN1QV3CGD8LKB56HEP2U0MUOHUOGP0MYOE45D1JN3LYXI3MWRMVI	GCDRIH330KVOSKK9OF075N43RA1PPU1OJA0CC46C17Z4G25PF9A0NIWS	d6d325f029210d2a7f430aaf568773ae90861c902e8d93b877f0306a86767cef	ENCRYPTED:f483e1bd42cadc0c3727e172e18d33fa	2026-08-24 02:56:13.762416+00
eef6fb67-f138-4c83-a99b-90294f164ed2	GKFBOSCRO8SK3596HHR8X8C28N1GPTC2QWF2HPNW1KINNDW8R8KUSSR6	GQK2919AHEJ8CX9J1ICTXCWNPGW90JPKL0BLV0PRKGYC4OM3WTOOBMZV	GB4TK3B33IZLX3AEYV7CS1R8NFVD6XDHYX3CXXL9E9NIVP8H4NOUWR61	GRDEXW2567H488S2XEM3FFZLSEGKRHJ5JN7BS08I4W02BSMEBO7V0VU5	379cef02beef689b191e0abdf987affc4b5076db2f4962bee685ce1452c6fad4	ENCRYPTED:7362493c6976b20846ec84f529cf755f	2026-08-20 02:11:13.76244+00
0d798424-3528-46f9-b366-cc10ebd33168	GUPZ5JR0Y2EFZ6RX35UAF3WE8ZN1N5RUSV9I5VDCG3BHK23A1MITKRFX	G5YHP5E7AXUIY0X8L4EBEAQNCDZ6S601ZF88JRFTF6NJ8UZET1PDPF1H	G7923TITKQO4XSDJWS3KK8SLLJKPHCUI2QXLN9CUWJX28K8THBZ5J3UJ	GA86VS4SJ2VH4CI9HTBZO2WFUDM7ORMBF82F6ZM5U6DXZJ1XYXASWWT2	6317ac319b7793927ac3316d61a0b24a867b9018d194d2609e0f531dd8562881	ENCRYPTED:31400a20d42ee250460b4c808bfe1d38	2026-08-20 11:01:13.762462+00
4cc7ec36-2515-4973-865e-775c8c1d460c	GQK2919AHEJ8CX9J1ICTXCWNPGW90JPKL0BLV0PRKGYC4OM3WTOOBMZV	GKT9A90FOH3HJ5S6R044P39JYM6IER0V6RAST5J284WV98Y3UMPYO0CU	G202SK10IFJNT47VEYFA0R0L93IMLYS95CTT593OBAJQT4HS0L5PBHR5	GEX41Q4HX6BQKDJU3IWKDRX0WDSS7E6MLGK8UUTRXG8WJAI7SX50VKGN	ddef2af239830986944cf99d9f9a6c2401c9a77ec0077ba1383083815cd73cd1	ENCRYPTED:2404d49a2b66542ff9fd15530b4decaf	2026-08-25 02:00:13.762487+00
f2311205-5ec8-42a4-aabd-9553913adb4f	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	GG73AJ0JE4QVZFV8YU58CEPSOF1GG2KTBCUDSWX1JP70LKLFYP5JO3Q3	GM9789H03EHIB4WTXI27VLTBHOIJOTINIF1HEB41CMGC6D4HQCETAGHN	GMLWBFJRWWK6P6EGA7NMSK8AGN64XL2GLWY1N6O0HUH3H7I5XS9CFU5H	cadab164022c2b8c54d06025b679f70b5f8b5aa5dc94631ccf4625f21d0c7793	ENCRYPTED:ecccc0ea500d8555473d5fd1cf22c439	2026-08-22 11:08:13.76251+00
ffefd656-8ca8-4c00-897d-8e28bbc97a7c	G3Z0GU1UQXJ4EFFF1GXI9D99VH0W1DSTWG6NJ4OGW9XHRO199BRBLRTV	G4K7YJPCHMB2U0J0N064DI7N9U47YUL38V8WQ4MPR9TOTSN5U4W9RSH8	GT2O90S1ME4XLA5GZ27FHJZZGKEXMVMZHO15RRZW4Z56RJ3GHQ55OIBG	GDE5BLYUJTGE753MS556Q8V88BC1HY2UY23CCL9TK51ITY5H598449K6	dfb29288a6f1616defd05548c5c02f16130c2d4217791014c45de9e33ac5430c	ENCRYPTED:a6f1d31fc2bc75dcebbd16a337dce09d	2026-08-26 04:59:13.762533+00
2c11bd8b-c2b3-4843-9a60-424387862d76	GDEZX6KBJ2CIEPXXYCJ2XX2EI7XZURPHBL57Y9HQQ2NS5MHIE2L2FUWE	GYXGO4B9UOE3T0HICCT5HGP8IY3X80J0G50RCXN22PXGX8WDZRMH3FNB	G5YWSUDBCIXWBVYG1WW0WDPPPTFETHVKB8UC3160RB4BUYYUG5GNV56V	GKTX1M5E8NSQDTZOFGVRE741NWET6T18UM0ZQ639LB7L5N3R81D7MX3J	317fe0d001f6a6687a50b3d90c4bde289df385c433cd41aeb4d1b3928d09fbbb	ENCRYPTED:c6c31006e43c95a54f898d80672935a8	2026-08-24 02:34:13.762557+00
e84bd023-7af0-4230-aaae-47ab9d4686ea	GHKTGBTYZMEPGTHCW81XE6VA05G1X3J1L7R8431RUPFR2P3YVB5UL5NW	GK23U0H8WN2T3QHFKTCNUJFPWZ6DTQLBZ299PG3GIHADOIMZXFQEBEM2	GT10UEN0RSKQPZPHJMBPT35911CMKRIBQR9LC5BDFUTE0XFZIPH6H77Q	G5FPHUVYP1NJGLNR20QD58XHU814PRJX4XTBCDPQ9YTXH8P2YAZQTFPT	3beea72631d74d162a0f10188aae444219f5311a0ad8f8db2229828639639568	ENCRYPTED:dfe04cebca831a9f37b0d216cd1c892d	2026-08-24 10:46:13.76258+00
a9dfab5f-0324-433a-9f1d-4d496067eb9d	G9P452BFSOZPTX497W19VW3RTQOHMUH8LMN4R7SGMSOXLTA8IRCD9SI5	GQXZXCZD9MX9SEY629RHIGZXV9XJM6Z6CCCIV473J6IUUKZTV6685T4B	GU0CRF540V1GKQ6EW09U3BDL2IAZMTUFHKP7I0U24IQLUSMF0XLZYOBB	G9OF3MQKDZ1QJFXKHA7135HONMRS5YI1NNSM0L0JBSQP2PX3FA4IUZNY	fbf194a8137a7e30b34c4b7a7c42a7457a1b51ea380398a1be8f87fe46e12575	ENCRYPTED:91e76900d713e4ac61ab1cb369d83534	2026-08-22 00:37:13.762604+00
dab99d7c-902a-4c9c-a5e8-ae88447a016f	GK23U0H8WN2T3QHFKTCNUJFPWZ6DTQLBZ299PG3GIHADOIMZXFQEBEM2	GVYV2V1ITUM4ULZUS5PUYRZXHM8L9B3N2SE05ITPQJ1YE24Z8608CX8F	GQEG9DDVP4WCAQ6YTZXI9CLQK65V3IFU71JQHUCI5RX1SQQ7U1KU5J92	GDMJDOLC4QK31H5C2W9535HJHWFNSLK6RNA7L0EP5GVBSHZXGUJBF343	19864e404ac5f43aed469030199d72fe640f257b5d59b0342a3f90a79fc00188	ENCRYPTED:171001ee18bb9f4d4980cc4384ce29e0	2026-08-23 18:40:13.762627+00
9d226218-6340-4e01-a9c6-c67177e90d4b	GVYV2V1ITUM4ULZUS5PUYRZXHM8L9B3N2SE05ITPQJ1YE24Z8608CX8F	GUPZ5JR0Y2EFZ6RX35UAF3WE8ZN1N5RUSV9I5VDCG3BHK23A1MITKRFX	GAVC2UINDSUDE9YFZQLPZFBNKYZSJHT51TIWGX6M52Y4R1F1XL11FC6V	G3OJ577FS31F4TJITP71SD9EC6G610G3QWQF6BH3LLZCF0TU32QVLNLF	264b26c4c6d13388e6a41bbb292ff970e08b6e6bc54345ff6d15290ed10ab733	ENCRYPTED:3b27a8e2b6de8f38f48ebb94b6053746	2026-08-19 23:16:13.76265+00
24e1e6a9-68b4-4a62-a899-4e6b262ae8a7	GYXGO4B9UOE3T0HICCT5HGP8IY3X80J0G50RCXN22PXGX8WDZRMH3FNB	GFGAN4EIO72AAVH1I4EOYFGGUXTIYIJE7AK2WNJ02NFGIHYW1UIPRFP9	GG18BAZHAK43Z5TXZTFIIAMHBMBN4JP18MFT3J41BHKJ254B2PMSZDVA	GG1059SC5Z565OD7B1U9ER04H5W21BKSM4W2O6OV3ISY0X4KNSF4ILMK	1962c72a3fc5f85741ed887ac02da87365d474437859f1e872fce3b9d020d41d	ENCRYPTED:78772fef3dcf40ebb73ad8c6bbf0fe6a	2026-08-19 22:48:13.762673+00
b624c618-dee7-4ccf-bc46-7a5d29137a17	GMLZ16UFZGLI4UPAQYP2RVTAQXPDH3TKZ6THSXOOI4J3X0948NPF727X	GG1WU16HYMQC1A78MX1EVUHT6T0UZS9IM0YLTZ9ATSN1U322N64KFS6V	G05TPN9DBWQWKL6CEV1HOH9O5QVWC9RJ6GD23HGG9C6GKHNXKS265GJX	GVIHM20AP4VS6KFRX0XPJ70OI10037XB2JA7EFVUZK1DZCJD7S0Z9TUW	183bcca73104b7ac601d62d009c29ccbeffe713ab6e41fbe5e49cda6290157af	ENCRYPTED:284fc086e8fbfd56d0e3c8f50fa9af60	2026-08-26 18:03:13.762697+00
2d74389e-c4e7-4905-88b5-59d4cc1172bd	GJARJI8QLHBIAWPUBLQDI07HE42X6G26OC7T3BD4Z1G52EFUJEIR9UY7	G0BPNEGC2DPCZ2O8NDI6SOUUPTJ7O0TRD9L195DWY7U00JTYL84POTJ3	GJZ2N82WZMTFC8VYI78SNF69T7VKBB8QPT16HDXQ6WHDH2TA3VP8OWTS	GIY7PGU7MX3GJ10FFD1I4N2EX7Z97ZQ51250KJ6I53I67HN34CK9XH0H	f2018f92f55310482638804ee097d692e61ea7083e0a4758ce2251234dc10063	ENCRYPTED:9c87405d7ae53a8e17eb10a5f6f177f2	2026-08-25 11:12:13.762722+00
77877a6d-b8f8-4b80-8e8b-9b429144ca26	GGVJICS4I42AFBQNJ971HSPTHDP03EH58B6PJS1AWP0LF7XE78669BY4	GKF51VG7CON4RCER8CLUBNJZETKPY8VYIF6WDG1OEVZUBR25OW9Y1LYF	GSC7JHXTXTS5BJJ0DTSNL5AH9WEC04T2VY4II6322JUF0YOZV8C2RFKB	GT9H9FM8D7M46BH8LBRNP2F8UZC5BV1L0B7UYQFHG8KSJLQFJT0KDULB	614c3e6777a97b2ee7efe7cc76e85ac73dbec9cd699695ab132d2db19016ad58	ENCRYPTED:0f155cfa0a66dde50d08302d449c38d5	2026-08-26 04:14:13.762745+00
c3951749-9cf4-4993-b16c-b5ef66d4a029	G03VKXTUFDJKDFR21520RN6HW1HS57TCOZDANTNIQSUHA51LIY8O69WE	GVICW8VL34LIE3CSMCMCUT6Z84QCMSWDVRHX1Z2YVL55X7RF1F1L8SUG	GGUJ0UQYHDMPP566YHRDU390E4B0OBR9GP9IT02F6NJX8KP8192CA3SK	GAD4RQYWN6SCK8ETFZHI9R1N6UVQ2RPUVN3VBIA4AAL095Z8FE8B2HWY	5436969fd51779bb21050c86a154bcf2f4259548b06386a0e03b5a98e2c71668	ENCRYPTED:d1f5fdd006c65f44b3046edb50c22a09	2026-08-20 00:01:13.762768+00
78ab251c-3eb6-47a4-a8b3-49f5e50ff166	G87CVIYJKLK2C0XP2S2O8PT4MX23SY670KMIQD4X9G7HSFKR26J1FO2W	GVICW8VL34LIE3CSMCMCUT6Z84QCMSWDVRHX1Z2YVL55X7RF1F1L8SUG	GLAH3XM2AOBRWMFTOO5XCR5NAMZHR65K9MLEIEIQO7RMB8Q93A1DU10R	GH735X7CODR082UAZMVFBO1EPMKVTEGB41BVQPG4PVDV7PE2G2HFDCYU	bb27dd7a099831ee4c6af419259632abf01cfc0e2f5f0c9b3d07809a6f70920d	ENCRYPTED:f82b5d9c8b80921814d9cc09b4c6c23e	2026-08-26 02:27:13.762791+00
33a64e2b-38ff-4339-8065-b7d04513a820	GY4AWTY088O5OR15BYVZK3I8BZBF1I3LDQYUN3UVYR0QF4B8DWOECBPM	G103DGDZVGPMM82I1LR3PE29GD8AFPK054NZDKYAYQ3S195JMSND8DUD	G2DT1EGD9DSYZG0OA3Y31GVB37VMGGAEMI6QW042LPICDIT16WT8JJ4T	GVSXA7JDP69D1WMMMEVM43VVT0VKG3C5OAOO3NP4VYNZLAXAEWB9HJS2	0a40b9484ce5ed1b764eec8643511078eb6bd973f1e1eac24a693bd01b15fd59	ENCRYPTED:1fd0b660f61a22f342fdc4a2322b01bb	2026-08-24 15:07:13.762814+00
e73d4af7-f99a-421a-bfc4-374c11788cb5	G1YANNREG8LXUM3HQ57UYZHWW3LTFIUHPTHLXJ6Y0IY1L58L9K5SILU2	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	GXCBMMSLOQLV9PLMBLQGBIYHVNT3PXXK71EHJIMM8YXU1PCM8SJUPDRI	G65NF4EK6Y6X573LUX7454RZCNOM2PZNT1YKXQ9FIFS27WOC36V12310	84d4a27f2bf056b25cdbf85057eef4952ce795b632b3b9cde5a0c3da8a26a7d1	ENCRYPTED:108b2a5ea096936d26446604290ebbb4	2026-08-22 15:51:13.762837+00
7f27be7e-1bf6-4b8d-98ad-6c4f077f6011	GMLZ16UFZGLI4UPAQYP2RVTAQXPDH3TKZ6THSXOOI4J3X0948NPF727X	GUK3XF1GP1Z7FZTVOVKE6H76MWWJPGJQMLJEL532UUJ2E42TRDW6ET32	GRYBL2OQEWFS668FROGHEXC8MVMVQTRMI8QATSWZZA46JZOON4O7933V	GFUM10N229BXIITA5WVO01Z8TUBCIJVZYNZE8YM4GV2TFKG9LC5BLMEY	8d8401abe95124d580e1055183aa40573bd62f0f280a3683867710261215fae9	ENCRYPTED:268b9045896dba45b0ed8e078f00039b	2026-08-23 14:42:13.76286+00
264078e8-c0d7-4b53-83af-52baf052edf4	GKT9A90FOH3HJ5S6R044P39JYM6IER0V6RAST5J284WV98Y3UMPYO0CU	GG73AJ0JE4QVZFV8YU58CEPSOF1GG2KTBCUDSWX1JP70LKLFYP5JO3Q3	GS7E3DX7AKU0ZKHI804EYNINT14KTM63RMAJ2EZP7V533CFS3WTZL0PL	G13YLGZCPKR8SEN509HXEG6U02KQN6C3BE3YVZMZCAQHIU353EF9P2I4	7c6bd4c8c1b4ff6830a0b5d41ff641eb1f46f43828684b56ce185531fc02aef3	ENCRYPTED:17762161b64cdca0d0cf73dd3f43a09f	2026-08-23 15:59:13.762882+00
b12962ae-66eb-4e30-bf01-f6595b870ed9	G9P452BFSOZPTX497W19VW3RTQOHMUH8LMN4R7SGMSOXLTA8IRCD9SI5	GYR9OUDOCUZRENUN5Z3JQIP98Q1ZXOI65FDHJK1EYY37Q9AH8RVHS1K3	GGLSH8ZKEARJ2WLNC8N2D7GYT2DADYMPXPMFB0BAVMEOGKKC06GUU9MN	G8Z1HONGWULAZUAYN3OERXCEN0T5G8KQGUYIVLU4EVB2Y6O6AOBHTP1P	1b61be486585983e4ba612e6b4ea58542607d817364eff94c2cf992304df9ea7	ENCRYPTED:7227d5bd6891c238aae47d9a8a5fe71d	2026-08-25 22:32:13.762906+00
f3eaa04e-8bf8-4f16-91d5-20ceceeafd1d	G103DGDZVGPMM82I1LR3PE29GD8AFPK054NZDKYAYQ3S195JMSND8DUD	GY4AWTY088O5OR15BYVZK3I8BZBF1I3LDQYUN3UVYR0QF4B8DWOECBPM	GX5SMJYNCP2VIRUC70SBOVVPN8DPOY7UL2AE5EMDJNIFL9NP6F13TKMP	G1LPTS2MR4FXZYK42161J4BY1FT8J9LQY3T3SY94EVI4MJMAA6X5Z0ZX	dc59d6ca84b4003ea04d06a550a84846148961d5905189ce4681b3b76f5a1f2b	ENCRYPTED:1ccf7ab31310ee26d41427f711b16b16	2026-08-22 11:20:13.762928+00
07ab76c6-33cb-459a-9a0f-b7e54c0738b6	GMLZ16UFZGLI4UPAQYP2RVTAQXPDH3TKZ6THSXOOI4J3X0948NPF727X	G03VKXTUFDJKDFR21520RN6HW1HS57TCOZDANTNIQSUHA51LIY8O69WE	GE0CHYKM1QW65XDY1PP4CXBJQ3JQPKAHFYZF7M1K1QT68YT0FGWJRNZT	GAK5AGE070S1KLXLIM5L6H2NLMDLMQ02GKFSFYHREVBP45GADRACGN7A	60cf99a01c124cf87490a2c1640f919e1ad1cb6b2cd7f7ad02a7b59763f79907	ENCRYPTED:a87282bd730faae8227456c2426040da	2026-08-22 13:38:13.762952+00
3d597a31-3cd0-47ea-bac1-51bb3570ec9a	GVYV2V1ITUM4ULZUS5PUYRZXHM8L9B3N2SE05ITPQJ1YE24Z8608CX8F	G0BPNEGC2DPCZ2O8NDI6SOUUPTJ7O0TRD9L195DWY7U00JTYL84POTJ3	GR54V1VXVUPXZYDWVGA3ZIBH7RPX2460MAUBXCU2O5ZFW14GYSMJ76CI	G5FT93K2H48PPNKFG1BKUYROQ4HI85FVOEVYY91OOQHSFHFVMHXIUYAT	8373b9beadcabdb8067e0c5d39f0c798e235ff898bd7f167a02e85c590a7436b	ENCRYPTED:4b85914a13a85ace86a0890af4111bbc	2026-08-26 03:19:13.762977+00
fdad9c96-e895-47a9-b22d-22c7f2ae207c	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	GXF8MDRYCEM9N4NVTANMH4PNZP9USY38WTQX653G4UNXU0COJBQ90SJM	GMY1UXI7OGZA83UJSO53JSJCUT6HR4N5SYDVJNODL5ZTKB9ZV14WZZE7	GSSM9ZGIUDT3KI24SJNNMAXGJY1KDGW4LDH6V1JZPCHPZ5TLYF3YR2XA	da456c74b3526d8c9f9ed4f7e190a0edff95ae9116b859a36691bd33cfc103db	ENCRYPTED:05598def7073298fc755cde10b172c3d	2026-08-25 11:26:13.763004+00
1324d258-7cc5-49e7-94e9-2168977014fb	G0MY5ZPJAG1OL73D9PH3I379U26192K42QPR75PR2ESPRVU8FIJOYJNE	GQK2919AHEJ8CX9J1ICTXCWNPGW90JPKL0BLV0PRKGYC4OM3WTOOBMZV	GH56OB4RGLY41TIGUE8LZBZ9875E78HNHLLA92UHCINKF9QCFH6TX8K1	GAPTC7S82I5U7W86NGCPCMJTNI9NWRI1E9QQYKZ3FQ1J8NERMX6K0JU1	5eba5823248359afd334bf144a164764ddebf7ce591b0b5ab69f1090d5fdeb0e	ENCRYPTED:774767989060d6fcae9c89b22cc1045f	2026-08-22 12:44:13.763027+00
d6b2903c-d602-40d9-b906-c59aa189ca8b	GYR9OUDOCUZRENUN5Z3JQIP98Q1ZXOI65FDHJK1EYY37Q9AH8RVHS1K3	GVYV2V1ITUM4ULZUS5PUYRZXHM8L9B3N2SE05ITPQJ1YE24Z8608CX8F	GPERH8H90EVFXVRJORAGYOYGHL7T5G7WS9RGDKUYLW89Z4IQA6JIJYRD	GXP03L2W36SR17OTFT0UFFEPFKDFS95A16I4568HZAMA18WP7C2K7OLE	fee305098672e1ba0c32793d2b82451fa414d406d84538264d9e6bde0850cc66	ENCRYPTED:0b4e2c928bf285cbc1657391a568e523	2026-08-22 15:59:13.763051+00
dab76554-a928-48b5-b81e-ea28466f18aa	GY4AWTY088O5OR15BYVZK3I8BZBF1I3LDQYUN3UVYR0QF4B8DWOECBPM	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	GWD15YKXHVP8HST4SQNAZNT6C35DWA3VTWGAWLZWAG15MF76J0H5AJQO	G4ZXTX1L8RG22KIW1AWMHMSCIZ0VCKM4RH0595IUZ6YIHGBIJW6APDV1	e09e279ba742a774ec5885ac4823f51d406174787b805742f9e68a5f4cea4ef5	ENCRYPTED:eb5a6b998074f88c4e3d38766e48913f	2026-08-20 01:10:13.763074+00
e411347a-ce21-4d52-8f6a-3ba8aeb6375b	GK23U0H8WN2T3QHFKTCNUJFPWZ6DTQLBZ299PG3GIHADOIMZXFQEBEM2	G1CBFNO6B9M80O2RAK1VRJNVGFYGWWQC38HYF9SXMECOSFOGYR3XKXWN	G14SS5F1PJ6LPRHQP1M4G6LMJOHIZCRMJ1BMFDY07TOOV14D61DTHRXR	GW0PUDLCADUNS4RG1LQ5XVTHGA9IVXX7XPRNYFGIHCMM2GE8VT4M8JCI	7b46d659da28f81f432847afe4e547713bb526514f604d39b3b1b807793eff63	ENCRYPTED:77dabd952eb37e581b0d2196ff24d338	2026-08-24 15:52:13.763096+00
d9d98907-c414-46b5-af9f-0a47e965c4d1	G9X39IFETZ4700EIUE237WI9LI16DH7JTKKUOW7SFQM9RIT8F6KJKVCB	GI85L8D7CEDA0IOEJAN63XD45BA890AB7R8SB61LGG7JPM7QWRZFXZ3P	GQ9WX2H1E4076BKRISCDMZ586EK26Y9YZRNLAKNA6367QTOSR9HKOC8P	GSCJRIRDPN8HAWXUF9QI0SUDAWORLQB8GYQ9N2OURNZJ2O1XJ4F5L3LL	a6852f4b49eafdd48c9d4b69066144b7f82be15dd623e9bce7ad91e5245cbbce	ENCRYPTED:df4eb083e4fc28f6f7ed12476edcb926	2026-08-24 16:38:13.76312+00
5b876599-8602-4d29-ad2a-51875b1ab28b	GKF51VG7CON4RCER8CLUBNJZETKPY8VYIF6WDG1OEVZUBR25OW9Y1LYF	GMLZ16UFZGLI4UPAQYP2RVTAQXPDH3TKZ6THSXOOI4J3X0948NPF727X	GLSBTKLZMEJE1P3ZG7IAGYYBHACIPFRJAAG8VFMI42KTV4JPD8R8HBCG	G8SG60JAOBO1YJWSOYH5KHOGSWEVHXFCJL17VL1JTSWGR5XQEAJJUJY2	fa8c123df45a1f26c7be2a8b7d4708cd527a35456c00617ebe7fb3ea7de92a6f	ENCRYPTED:3daf4eace4a3bdef60cc2a3489364ad6	2026-08-21 09:34:13.763143+00
c7d4f985-8eea-4124-b2da-e9d2f18b8d39	GEPZHPCF07UQNUPQZIT3UEA3GE8N6QIWEPXSK28T7A9TGIQHG9JRSNVN	G0MY5ZPJAG1OL73D9PH3I379U26192K42QPR75PR2ESPRVU8FIJOYJNE	G1RJFUILYWU5140VIPY09588588OYF07OFPXANBX94IHDWXIS3J90PNO	GDIHJYB1XDGE4KBJXJFPEA0JL4I7T40V2ASHJDCL6KAZ139Q6TO1KRF7	5a858ef90a3c7a8d52a2fce1aead73acdf6e5ad07798bc43949fd427d902fed1	ENCRYPTED:53b56727fe082eea567f95e7ee473fa7	2026-08-22 13:07:13.763165+00
8e64008d-3b4d-4aac-9910-bdccd53b05ac	GY4AWTY088O5OR15BYVZK3I8BZBF1I3LDQYUN3UVYR0QF4B8DWOECBPM	GK23U0H8WN2T3QHFKTCNUJFPWZ6DTQLBZ299PG3GIHADOIMZXFQEBEM2	GNZDOZL9E34UZYKDX1MRGGEXVBPSK8GENATM9MCPRFC4CDUFTAWSZ6MU	GZWIGV06G6JBY4CSKJ3FFONJK677V2IVSX1CYPNEJ5GAJT9F5G3UKSKE	929b316357e5779ddbfcf2d7538fed17b47c975701010c70b7d822ec8ffaa685	ENCRYPTED:4f1cbdbe41fdd4e88345bd871516488c	2026-08-23 15:43:13.763188+00
d33df95c-a281-4d65-a4d6-c231846437f9	GKF51VG7CON4RCER8CLUBNJZETKPY8VYIF6WDG1OEVZUBR25OW9Y1LYF	GGVJICS4I42AFBQNJ971HSPTHDP03EH58B6PJS1AWP0LF7XE78669BY4	GWFEL3Q4Q2IH5CXSZ0I2X6UXF062QCDP9AJGSYKZEOY3FW3383GFLGZ1	GMZVEUV5N4HR3C8J4JNUCYDX14NDNB1RQLFJERZFT207NQLDF1VTKMW0	4562fcacdf64d0d29562bd032f6a5fedf99b0e7c7fb29c874a7ddd1602bf2de0	ENCRYPTED:297a3d02e19f5695f6d5ed132076b6d6	2026-08-21 08:42:13.763211+00
2b02abd3-7c7d-47f9-87dc-2fddb5ef409a	GNM8R9RIGPPD7OODG0V4GIA9K044MSUSDFO8CL0LCZ5LSCATGVS3875I	GXF8MDRYCEM9N4NVTANMH4PNZP9USY38WTQX653G4UNXU0COJBQ90SJM	GK1WYA9MEJUUAJ3J5UH0Q7A2I2GCNM08KYNWNMAXXBTT6H5300WW817V	GHL31XL9K81YS1SGFGFB0G58G26CS0NO39YHM4HW30ZAXO6SRQT0PA0C	04fd78a29ec9be84634ee3b8d7f9477eed437e680df309ef938a4b3216214027	ENCRYPTED:78277bdfa89332171da35273627744e1	2026-08-26 15:58:13.763235+00
8b5ecbfb-9497-44d0-8e10-1d871487cb7c	GYR9OUDOCUZRENUN5Z3JQIP98Q1ZXOI65FDHJK1EYY37Q9AH8RVHS1K3	GHKTGBTYZMEPGTHCW81XE6VA05G1X3J1L7R8431RUPFR2P3YVB5UL5NW	GX7UVK1P9ZMZD1IYLZU7K1OGI6HZQ9KUNFFB1AJB8FYBI3WLPOTM8PYQ	GDRFJBGH3HGJSQLFE5XNZG5B0E5EN0YU2KLTALCHVW48AK7QHMB8B76J	5947ec22cd497d4efb5b29ea1b6a4cd84eb7b8a4861600673749460885bca6e0	ENCRYPTED:a476a53095fd08ba991c4b69ce2c0e25	2026-08-24 09:09:13.763257+00
0e1a0145-97dd-4c7b-9714-5fe240fec402	GGVJICS4I42AFBQNJ971HSPTHDP03EH58B6PJS1AWP0LF7XE78669BY4	G0MY5ZPJAG1OL73D9PH3I379U26192K42QPR75PR2ESPRVU8FIJOYJNE	GNBUIOFIRR4MFW9S3516ZMQLMRZGTKN5121RUGY1MWXE2KC6Q0S7WZBH	GLU1LWPENXXJUHAUAVN3UO9EYSN7NG9RE01UUMMD55CR0HH2KUYPBSBA	a9c118a9de3f4cc7ee2e0ac22d0832a882d9abaad49333195b4c9ee3335c9e6c	ENCRYPTED:193d6fa3462539387b7c4567254c170a	2026-08-21 14:07:13.763282+00
714d58ac-dd33-44e8-b278-c7375c9765b9	G3Z0GU1UQXJ4EFFF1GXI9D99VH0W1DSTWG6NJ4OGW9XHRO199BRBLRTV	GY4AWTY088O5OR15BYVZK3I8BZBF1I3LDQYUN3UVYR0QF4B8DWOECBPM	GZC87CVBE4G0TRUWZF9U5DZT35HXGBODAIGU1OKFMX8ADQCHDTEQVYRK	GI3HIUJ02H77P45RU4OFQSFW9PNEE5DNAN3YM5GVN76UT3J6GIOXY26M	240b6a7264e6affe9162e96be36645303d9cc657643eb9092aa0d53482c809be	ENCRYPTED:010e2e9624ff118c597ec7f95e39219b	2026-08-22 06:56:13.763305+00
9a9789ea-980e-420c-abe8-38c6603166de	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	GEPZHPCF07UQNUPQZIT3UEA3GE8N6QIWEPXSK28T7A9TGIQHG9JRSNVN	GR1KTGJ3GHPB3LRB472WQH9FW1NJZ616VD2RXGDY1MSMZLR7571GDPHO	GHDCRPE8GROZZZGOR5NKNWSSAGL64TPKUEKLV3JA41VBLQEKAW4A5P4H	5624c51c28110bb1fe92379f02f825280403330fd3efe4c47b52a99a1985ca61	ENCRYPTED:78036e214dc72f72c00a1e3aec68df3d	2026-08-26 07:52:13.763326+00
17bc66cf-92ca-48f6-8593-aa0321011d8a	GYR9OUDOCUZRENUN5Z3JQIP98Q1ZXOI65FDHJK1EYY37Q9AH8RVHS1K3	GKF51VG7CON4RCER8CLUBNJZETKPY8VYIF6WDG1OEVZUBR25OW9Y1LYF	GSO76KJGGTV25W8Q5QX3AWTV74HR7BJ0OJW5BP1XNFMYGR827LQWVZ0R	GTMC7VH13WSHA5J3J7S9KT5SESA3CNSHD5TA1WADQIWS69JFRJM1FSOC	7253eacb7197e46a6d0587fea7bfd97383f59c564d4971dabee12fb686723140	ENCRYPTED:c46d10d3dcc05cfa05ebb969dfa61799	2026-08-21 11:00:13.76335+00
d99750d7-b470-46c1-b008-d470fbbbbbf5	G87CVIYJKLK2C0XP2S2O8PT4MX23SY670KMIQD4X9G7HSFKR26J1FO2W	GQ3TMY4GPYWSSBZRAD5SOWOMQIGCT2CXIFSU0LMI8X76RKQ4SVH3EJOZ	GY1ZGQTTL1UIMQI09MTTFT38LY1GI72U6W3W13003B9B0FITP6XI8SDZ	GIZA373DFDRGVGS4VDH6DN7J95IOJTTA5MHEAJH7GPNG4B62ZDHTZ4LP	0df92667debb61d365295c32b09b04539951fb65e491bfd0356c18ec161e20c5	ENCRYPTED:6f39186a657f09c881731259e61177c6	2026-08-20 14:55:13.763372+00
14eb5a47-07f0-4af2-9c25-2f3ca25efe34	GYXGO4B9UOE3T0HICCT5HGP8IY3X80J0G50RCXN22PXGX8WDZRMH3FNB	GGQO679O2XZ36JWB4GS0FHJWTV3N74W4G22UETCHBVGKP7L9KV913OZL	G2H1JBLJPK68M44SSG5XRZYG301JBS3HYATC2CWI33RAKW66NW7Y6ELJ	GWV3IRTZE4Y4L67QIUWZECBKOGG54UOPGLY0EDQHCE2XBLUG2YI9MMQ5	77c349e3058da632f3bbbdd7c4febd7e317fa91d2099131edd34169a46ea3666	ENCRYPTED:a4f3d05bbc5e4735d8e6ea08b502097f	2026-08-21 20:44:13.763396+00
d0ac4a69-d62e-47c8-92e5-c6c3f562820f	GFGAN4EIO72AAVH1I4EOYFGGUXTIYIJE7AK2WNJ02NFGIHYW1UIPRFP9	G3Z0GU1UQXJ4EFFF1GXI9D99VH0W1DSTWG6NJ4OGW9XHRO199BRBLRTV	GOMK17MFBGNCIAX08EVL75MN46WW9IE21YEFI7TGH5OD8VBOSQYWEKSE	G8P76TZD8H4QBCV0QMVDIN9VDP5ECWE0F94IRCGC56OW14TOBDBM8YB9	c60d654730f6d3c96f8a05030ef543aa808700cf213382ab358d4b58bbcea981	ENCRYPTED:4fa95e11fe1efad0a3fec2fad82dee0b	2026-08-21 08:33:13.76342+00
abedadf7-0478-49b3-ab86-6b8770b0a58f	G103DGDZVGPMM82I1LR3PE29GD8AFPK054NZDKYAYQ3S195JMSND8DUD	GVICW8VL34LIE3CSMCMCUT6Z84QCMSWDVRHX1Z2YVL55X7RF1F1L8SUG	GYI119IH2HXWMV1DPOFAO08CAPDEDI2LSCUWPSIZ4HEEQ8N5WO2TX9SP	G7RU86GDW05RFNI7OT9NHXJCP23HB5CRRYTFDRY5BYY2CONYL18DTC8W	d082c6fb0fd1840ec818dbf3b3b620ebff3eeb6a4cce2ff367371ee7b03ccb55	ENCRYPTED:de57754015b7156380c176e93d143b88	2026-08-26 13:07:13.763442+00
7ef1cde4-aeab-4248-b039-3c3d5126c007	GVYV2V1ITUM4ULZUS5PUYRZXHM8L9B3N2SE05ITPQJ1YE24Z8608CX8F	G1Z5BY1LWNLRR2JCPS5094DFRYI0M7P8BYW485W6UYRLBUOBRD47WOKG	GVQNBV11DG9YS8317QKY3PIARRFP8SVZCRXRQAHTUQL23B2A3CW49N0D	GFR9UE2LQRQ5IOLJDOHCL62UC9ODQQBW8CPWGE62H6EPNUX0E1SJBUXV	bd0e715b972615d27cde9ef4f3a7eaf22183a49e8d84b88709ec07f27de3c138	ENCRYPTED:cd8abc6cd39a31cf657945ba0d1c458d	2026-08-22 04:46:13.763465+00
699ecaf5-d6bf-4395-8384-d49093cafb68	GKFBOSCRO8SK3596HHR8X8C28N1GPTC2QWF2HPNW1KINNDW8R8KUSSR6	GGVJICS4I42AFBQNJ971HSPTHDP03EH58B6PJS1AWP0LF7XE78669BY4	G4SBKXCSJBGNU66WNYCJYFEO6908H7D4772URMSPVPXO3UHP20XFW96E	GX4O20OI8P0IQSVUHF006J5ML3AKH0Q94GIC1BKEI67Y1WIZ9PSHVVGC	1e4ff9eaf0096750047e6b78c7c9ce84469c8c7233de63170f9c217351847b81	ENCRYPTED:1e74a8d7b46365151cb4e74c52262e65	2026-08-26 00:04:13.763489+00
83f6e652-ed7d-4f10-8d9f-57b7fcf0e41f	GK23U0H8WN2T3QHFKTCNUJFPWZ6DTQLBZ299PG3GIHADOIMZXFQEBEM2	G87CVIYJKLK2C0XP2S2O8PT4MX23SY670KMIQD4X9G7HSFKR26J1FO2W	G2021S4IL6FJAX3YU2L6RGOT5VD7761SUYULJCN17RUGWSKHSR52OKSQ	GGORJGN96KBC88MA5BXNS127I3SHH215QFIRHWFOEUK6VR36EUC1G7UM	b09a772b58f884cc76e807bfef6acbef912e025f9899a768dfd0a970e695903e	ENCRYPTED:acdf90888e8f0551782c6d6dc44cd58e	2026-08-20 11:47:13.763512+00
cf3d581c-3f96-4fde-85b4-29c6cd2642a3	GUPZ5JR0Y2EFZ6RX35UAF3WE8ZN1N5RUSV9I5VDCG3BHK23A1MITKRFX	G1YANNREG8LXUM3HQ57UYZHWW3LTFIUHPTHLXJ6Y0IY1L58L9K5SILU2	GCAPIYOMQ4J5L5SIMF7NA1E59NLC0QYPW47LTOS55ZW84SGOHS02UP1H	GL3UHWZI450PBSR6N0D9UQU0Z21ZQDR5OVCT20OK8NHVI8BBYFVW9ED7	efb7890cde476f849fc2da0d902a3edf3632a3b6ebd3f13f050b06cb6e5394ca	ENCRYPTED:bd9a17d377b22bf8ca7bc115ea464eba	2026-08-24 10:44:13.763534+00
a2720ac5-fe2c-4e19-b8e6-b79946b0a09e	GGVJICS4I42AFBQNJ971HSPTHDP03EH58B6PJS1AWP0LF7XE78669BY4	GXF8MDRYCEM9N4NVTANMH4PNZP9USY38WTQX653G4UNXU0COJBQ90SJM	GMK8ZOSKXV0N9PACB7G6Z5CKSTBOPCRHYZIRFEE60BA8JGZMTU16BTR3	GMGQ4YS1FO09R4S86PYB5ZX8G2OBZO2X4GTVJFG9KN5PFJZ47OD5Q0TV	b7d118afe48a24bcd98bfe9167287a404de915d6dc7d2a25f77d025d9fb1a12c	ENCRYPTED:4de9ab2bb9fc5b613342f0aad2d4743c	2026-08-25 03:05:13.763558+00
475ba168-4f6e-41ee-a64b-8accff852dce	GXK87AU5BHXTPDPFF5E8II49KQ71N8MTZX272HPOEVB9OOAEDOECVE6P	GUK3XF1GP1Z7FZTVOVKE6H76MWWJPGJQMLJEL532UUJ2E42TRDW6ET32	G0ARN9585UPU3469FG1EYIAK7HKM2HC15K75I90ZASH1SR7UXKJS7NX7	GQ43NVIK74AU0LJ4EATMMG83VGD3KEW9OWAMRS1TXZQ98MEJGNRLQGI7	c2bb067f0d4d3aed3eabb2174b7ab4ba660560359bc2c22ef538969baed5a8da	ENCRYPTED:2fa382700806394bffe8410c802502fa	2026-08-20 03:50:13.763581+00
0538c1b4-57b6-4ed3-8613-9aebc85a4f32	GKFBOSCRO8SK3596HHR8X8C28N1GPTC2QWF2HPNW1KINNDW8R8KUSSR6	GLLPUWBWJM58TL5CFDOOB74AVMIVLUDBJJH7XEXZGVTUIK15UL9WOLYT	GYVR4NKAONFJJK4AUEDI6214UT6HP9ZYY4WT7U7FNKRJ1925QH91WLBX	G3W1N9MYXLAM2X7MATVGXQ6ARCR4ZCQRDB435L48GCXBJLIF0HD2DUG8	b82bc0def9cfb10147399ca5130541f032a500b3e81485869e156d0487e90204	ENCRYPTED:1044fa8030c77b00e4bf1ff53678ffcd	2026-08-23 16:26:13.763604+00
d9b006ff-5285-4469-9c2b-79ce8721578c	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	GKFBOSCRO8SK3596HHR8X8C28N1GPTC2QWF2HPNW1KINNDW8R8KUSSR6	GBVUKX7AZ0DEM6JRFL2CRM60LATR9WHV3F3FHFLFLUBKANX3FPTMITDY	GSLRIU0OMRMLSQ2QF5WXW72KCYJ8N1WSNV69RF6NQN3QCH7L4I3UXYCU	e8d1ddbbe6b0ce2e419ae307173ee35a4dac4dc0b514324f5a4f26713b9b979b	ENCRYPTED:cb5de3ea58354aede2e9a104b77175db	2026-08-25 15:39:13.763627+00
cb64d592-694c-4f4b-8b8c-3093b4818fe8	G1YANNREG8LXUM3HQ57UYZHWW3LTFIUHPTHLXJ6Y0IY1L58L9K5SILU2	G87CVIYJKLK2C0XP2S2O8PT4MX23SY670KMIQD4X9G7HSFKR26J1FO2W	GAK04VVGLWTK38LB231Z4PQXV4ZTCO6G01RZBK6KT7MIIVDFTJW3ZK3A	GJMLTTFLPN1FPJ9XA4KWG49ZN4Y3PGYIUIZUS1Z8EW5BOLPXXV6AZEOI	3edd3233b139c9d67b1873b49112cbf1a924a563df18159caaab2eaedfa76bfe	ENCRYPTED:338528d6ab7d4e198b696e6060649c5e	2026-08-21 03:41:13.763655+00
7541450c-75c7-4a6e-b361-fe0bf59eda1c	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	GXK87AU5BHXTPDPFF5E8II49KQ71N8MTZX272HPOEVB9OOAEDOECVE6P	GNT1FVYL1JSTY4CQ0LKZ7G3FWGZAKUI6Y3A5Z1DT1QH26X4V8XHL18YF	GJAVQM631D3SCH53XDXQ1VSB8RLSW0B2UTCHWC8ZPLF8GIJ51RW3P73C	dfd455d76445fbb09a07242fb3d0e1abfb20a68c5de37175fd495af7546afc5d	ENCRYPTED:1a3d9de6cbe94336236fe829880e0b49	2026-08-25 23:19:13.763677+00
\.


--
-- Data for Name: progress_updates; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.progress_updates (id, job_id, author_address, update_text, created_at) FROM stdin;
a89a6665-12b8-4ba1-b8b8-c6492012a73b	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	GQ3TMY4GPYWSSBZRAD5SOWOMQIGCT2CXIFSU0LMI8X76RKQ4SVH3EJOZ	Pushed latest changes to the feature branch.	2026-06-26 20:13:13.760779+00
6bfeb513-a6de-4326-ac28-01328522b43e	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	GQ3TMY4GPYWSSBZRAD5SOWOMQIGCT2CXIFSU0LMI8X76RKQ4SVH3EJOZ	Blocked by API changes. Will update once resolved.	2026-07-05 20:13:13.760779+00
e5a35b3d-1fa6-4b1c-86ad-3e16de19d2af	d6c54b77-d3d8-4398-9cc7-0edbaefbfeb0	GQ3TMY4GPYWSSBZRAD5SOWOMQIGCT2CXIFSU0LMI8X76RKQ4SVH3EJOZ	Completed milestone 1 and submitted for review.	2026-07-02 20:13:13.760779+00
a79fa691-eb97-423c-aaca-64a6add190f3	249e0244-7263-4347-9003-c40eeeadb1e9	GHKTGBTYZMEPGTHCW81XE6VA05G1X3J1L7R8431RUPFR2P3YVB5UL5NW	Pushed latest changes to the feature branch.	2026-06-08 20:13:13.760832+00
67ebb9f2-3d72-41d6-99d2-29c042ec0898	b58a7d47-2106-4e8c-9051-fdc81013b0c9	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	Client feedback incorporated. Ready for QA.	2026-08-19 20:13:13.760871+00
487c7481-5e8a-4a88-a89f-0c4d3597c0bf	b58a7d47-2106-4e8c-9051-fdc81013b0c9	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	Completed milestone 1 and submitted for review.	2026-08-15 20:13:13.760871+00
972aadce-5c76-439f-9687-03cd5d3c1b1d	b58a7d47-2106-4e8c-9051-fdc81013b0c9	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	Pushed latest changes to the feature branch.	2026-08-24 20:13:13.760871+00
\.


--
-- Data for Name: ratings; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.ratings (id, job_id, rater_address, rated_address, stars, review, created_at) FROM stdin;
3a7ad867-53a8-4189-90be-174a274b050e	9a4bcb03-e3d7-4f0d-873e-74b09d248097	GJYUXGFAT2XRGIFL129960GBFW9FUYAS0YF9P7KYKIRTR5JEK1R0T4EX	GQK2919AHEJ8CX9J1ICTXCWNPGW90JPKL0BLV0PRKGYC4OM3WTOOBMZV	4	Outstanding attention to detail. The smart contract passed all audit checks.	2026-08-26 20:13:14.045115+00
\.


--
-- Data for Name: referrals; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.referrals (id, referrer_address, referee_address, job_id, status, payout_amount, paid_at, created_at, depth, parent_address) FROM stdin;
ca8ab8ca-8d24-47b6-b9f6-4a1a1107f082	GJARJI8QLHBIAWPUBLQDI07HE42X6G26OC7T3BD4Z1G52EFUJEIR9UY7	GDEZX6KBJ2CIEPXXYCJ2XX2EI7XZURPHBL57Y9HQQ2NS5MHIE2L2FUWE	\N	paid	\N	2026-08-17 20:13:13.761766+00	2026-08-26 20:13:14.09064+00	1	\N
ace18ea8-3722-4a75-9afe-7dd5d58f7bcf	GY4AWTY088O5OR15BYVZK3I8BZBF1I3LDQYUN3UVYR0QF4B8DWOECBPM	G9X39IFETZ4700EIUE237WI9LI16DH7JTKKUOW7SFQM9RIT8F6KJKVCB	\N	ineligible	\N	\N	2026-08-26 20:13:14.09064+00	1	\N
361aed10-cdb6-4ceb-aac9-c2385c6237c6	G03VKXTUFDJKDFR21520RN6HW1HS57TCOZDANTNIQSUHA51LIY8O69WE	G5YHP5E7AXUIY0X8L4EBEAQNCDZ6S601ZF88JRFTF6NJ8UZET1PDPF1H	\N	ineligible	\N	\N	2026-08-26 20:13:14.09064+00	1	\N
0c4f495a-f87f-4cb5-8830-72754f912275	GI85L8D7CEDA0IOEJAN63XD45BA890AB7R8SB61LGG7JPM7QWRZFXZ3P	G1YANNREG8LXUM3HQ57UYZHWW3LTFIUHPTHLXJ6Y0IY1L58L9K5SILU2	\N	pending	31.5842119	2026-08-03 20:13:13.761784+00	2026-08-26 20:13:14.09064+00	1	\N
6fab1522-e038-4c21-b46c-463d4291c16c	GFGAN4EIO72AAVH1I4EOYFGGUXTIYIJE7AK2WNJ02NFGIHYW1UIPRFP9	GY4AWTY088O5OR15BYVZK3I8BZBF1I3LDQYUN3UVYR0QF4B8DWOECBPM	\N	ineligible	\N	\N	2026-08-26 20:13:14.09064+00	1	\N
6a18a12d-8ec9-4c72-9d1f-6d8250a95949	G5F62D3I603D93TBZQANEC1WE8DE4CS0LI0XY2YYF8IWHL8Z7IOABT38	GXF8MDRYCEM9N4NVTANMH4PNZP9USY38WTQX653G4UNXU0COJBQ90SJM	\N	ineligible	\N	\N	2026-08-26 20:13:14.09064+00	1	\N
55a98661-d80f-4e2c-a9e9-b3dd96f67a9c	G1Z5BY1LWNLRR2JCPS5094DFRYI0M7P8BYW485W6UYRLBUOBRD47WOKG	G87CVIYJKLK2C0XP2S2O8PT4MX23SY670KMIQD4X9G7HSFKR26J1FO2W	\N	ineligible	28.9612715	\N	2026-08-26 20:13:14.09064+00	1	\N
e61e1753-4cd9-4317-b288-539c6d8f503f	G9X39IFETZ4700EIUE237WI9LI16DH7JTKKUOW7SFQM9RIT8F6KJKVCB	GFGAN4EIO72AAVH1I4EOYFGGUXTIYIJE7AK2WNJ02NFGIHYW1UIPRFP9	\N	ineligible	\N	\N	2026-08-26 20:13:14.09064+00	1	\N
d008f139-c4bc-48dc-baf5-56db99f70dfb	GT4PZT3EDK2043NVJUUWZIX69GUP3HR2PJGDSY0PKUUMK5635T5BFZ63	G1CBFNO6B9M80O2RAK1VRJNVGFYGWWQC38HYF9SXMECOSFOGYR3XKXWN	\N	ineligible	19.6626454	2026-08-22 20:13:13.761799+00	2026-08-26 20:13:14.09064+00	1	\N
f34d5d4c-47e9-44ec-8d9f-550d9e297f75	G6852FC1UQBFOBRCL472RL15F4W0VUGKV05SZ9C3FUQUHZ6A830DM7X5	GJARJI8QLHBIAWPUBLQDI07HE42X6G26OC7T3BD4Z1G52EFUJEIR9UY7	\N	pending	\N	\N	2026-08-26 20:13:14.09064+00	1	\N
1b745229-a6e6-47f9-aec1-041e1a1ed750	GHKTGBTYZMEPGTHCW81XE6VA05G1X3J1L7R8431RUPFR2P3YVB5UL5NW	G103DGDZVGPMM82I1LR3PE29GD8AFPK054NZDKYAYQ3S195JMSND8DUD	\N	ineligible	\N	2026-07-22 20:13:13.761805+00	2026-08-26 20:13:14.09064+00	1	\N
06c12b49-1c47-4ff6-b9ac-47cbacdec3fd	GXK87AU5BHXTPDPFF5E8II49KQ71N8MTZX272HPOEVB9OOAEDOECVE6P	G87CVIYJKLK2C0XP2S2O8PT4MX23SY670KMIQD4X9G7HSFKR26J1FO2W	\N	paid	43.5337333	\N	2026-08-26 20:13:14.09064+00	1	\N
\.


--
-- Data for Name: referral_payouts; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.referral_payouts (id, referral_id, referrer_address, referee_address, job_id, amount_xlm, contract_tx_hash, created_at) FROM stdin;
\.


--
-- Data for Name: referral_tree; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.referral_tree (child_address, parent_address, depth, registered_at, on_chain_tx) FROM stdin;
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.schema_migrations (version, name, applied_at) FROM stdin;
1	V1__initial_schema	2026-08-25 23:29:12.576704+00
2	V2__admin_2fa_and_drafts	2026-08-25 23:29:12.796944+00
3	V3__contract_events_and_indexer_state	2026-08-25 23:29:12.821164+00
4	V4__developer_api_keys_and_audit_trail	2026-08-25 23:29:12.86768+00
5	V5__private_message_nonce_unique	2026-08-25 23:29:12.917399+00
6	V6__job_recommendations_index	2026-08-25 23:29:12.939833+00
7	V7__job_search_filter_indexes	2026-08-25 23:29:12.962563+00
8	V8__dao_governance	2026-08-25 23:29:12.976355+00
9	V9__milestone_escrow	2026-08-25 23:29:13.010199+00
10	V10__in_app_notifications	2026-08-25 23:29:13.015099+00
11	V11__query_optimization_indexes	2026-08-25 23:29:13.034967+00
12	V12__decentralized_storage_insurance	2026-08-25 23:29:13.072612+00
13	V13__referral_tree	2026-08-25 23:29:13.202384+00
14	V14__platform_fee_referral	2026-08-25 23:29:13.239138+00
15	V15__ml_ranking_shadow_mode	2026-08-25 23:29:13.255325+00
16	V16__assessment_authoring	2026-08-25 23:29:13.269173+00
\.


--
-- Data for Name: scope_sessions; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.scope_sessions (session_id, content, cursors, finalized, finalized_payload, expires_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: sla_violations; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.sla_violations (id, file_id, owner_address, violation_type, availability_score, reported_by, created_at) FROM stdin;
\.


--
-- Data for Name: webauthn_credentials; Type: TABLE DATA; Schema: public; Owner: stellarwork
--

COPY public.webauthn_credentials (id, public_key, credential_id, credential_name, public_key_cose, counter, transports, created_at) FROM stdin;
\.


--
-- Name: availability_check_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: stellarwork
--

SELECT pg_catalog.setval('public.availability_check_history_id_seq', 1, false);


--
-- Name: insurance_claims_id_seq; Type: SEQUENCE SET; Schema: public; Owner: stellarwork
--

SELECT pg_catalog.setval('public.insurance_claims_id_seq', 1, false);


--
-- Name: insurance_premiums_paid_id_seq; Type: SEQUENCE SET; Schema: public; Owner: stellarwork
--

SELECT pg_catalog.setval('public.insurance_premiums_paid_id_seq', 1, false);


--
-- Name: insured_files_id_seq; Type: SEQUENCE SET; Schema: public; Owner: stellarwork
--

SELECT pg_catalog.setval('public.insured_files_id_seq', 1, false);


--
-- Name: oracle_proofs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: stellarwork
--

SELECT pg_catalog.setval('public.oracle_proofs_id_seq', 1, false);


--
-- Name: sla_violations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: stellarwork
--

SELECT pg_catalog.setval('public.sla_violations_id_seq', 1, false);


--
-- PostgreSQL database dump complete
--

\unrestrict slxeQgROxJa6pedUc6k6E7ClYyUhpTVdiAFCSC2pqeoSQSmHed5d919vKfgMuK9


benchmark_cas = [
    {
        "question_id": "EX5-F19-Q01",
        "domain": "ratemaking",
        "topic": "premium_calculations",
        "question_text": {
            "prompt": "Given the following quarterly exposure information and the notes provided, answer the following:",
            "type": "multi_part",
            "parts": {
                "a": "Calculate the 2017 policy year earned exposures as of March 31, 2018.",
                "b": "Calculate the in-force exposures as of May 31, 2018.",
                "c": "Calculate the calendar year 2018 unearned exposures.",
                "d": "Calculate the calendar year 2019 quarter 1 earned exposures.",
            },
        },
        "inputs": [
            {
                "name": "written_and_earned_exposures",
                "type": "table",
                "data": [
                    {"quarter": "2017 Q1", "written": 100, "earned": 5.00},
                    {"quarter": "2017 Q2", "written": 450, "earned": 247.50},
                    {"quarter": "2017 Q3", "written": 400, "earned": 427.50},
                    {"quarter": "2017 Q4", "written": 100, "earned": 52.50},
                    {"quarter": "2018 Q1", "written": 125, "earned": 53.75},
                    {"quarter": "2018 Q2", "written": 550, "earned": 528.75},
                    {"quarter": "2018 Q3", "written": 475, "earned": 562.50},
                    {"quarter": "2018 Q4", "written": 30, "earned": 59.00},
                ],
            },
            {
                "name": "notes",
                "type": "notes",
                "data": "The company started writing business on January 1, 2017. The company stopped writing business on December 31, 2018. The quarterly earnings pattern was set by analyzing historical experience across the industry and is not uniform. All policies are annual and written on the first day of the quarter. No policy cancellations or mid-term adjustments.",
            },
        ],
        "expected_answer": {
            "type": "multi_part_numeric",
            "parts": {
                "a": {"value": 780.0, "tolerance": 0.01},
                "b": {"value": 1175.0, "tolerance": 0.01},
                "c": {"value": 293.5, "tolerance": 0.01},
                "d": {"value": 52.75, "tolerance": 0.01},
            },
        },
        "question_point_value": {
            "a": 0.5,
            "b": 0.25,
            "c": 0.5,
            "d": 0.5,
        },
        "source": "CAS Exam 5, Fall 2019, Question 1",
        "tags": [
            "written exposure",
            "earned exposure",
            "in-force exposure",
            "unearned exposure",
            "calendar year vs policy year",
        ],
    },
    {
        "question_id": "EX5-F19-Q02",
        "domain": "ratemaking",
        "topic": "premium_calculations",
        "question_text": {
            "prompt": "Given the following policies for an insurance company:",
            "type": "multi_part",
            "parts": {
                "a": "Calculate the written premium for the fiscal year ending July 31, 2018.",
                "b": "Calculate the in-force premium as of December 15, 2018.",
                "c": "Calculate the 2018 calendar year written premium if Policy C is cancelled on March 31, 2018.",
            },
        },
        "inputs": [
            {
                "name": "policies",
                "type": "table",
                "data": [
                    {
                        "policy": "A",
                        "effective_date": "2017-03-01",
                        "expiration_date": "2018-02-28",
                        "written_premium": 1200,
                    },
                    {
                        "policy": "B",
                        "effective_date": "2017-06-01",
                        "expiration_date": "2017-11-30",
                        "written_premium": 1500,
                    },
                    {
                        "policy": "C",
                        "effective_date": "2017-07-01",
                        "expiration_date": "2018-06-30",
                        "written_premium": 2000,
                    },
                    {
                        "policy": "D",
                        "effective_date": "2017-10-01",
                        "expiration_date": "2018-09-30",
                        "written_premium": 750,
                    },
                    {
                        "policy": "E",
                        "effective_date": "2018-01-01",
                        "expiration_date": "2018-12-31",
                        "written_premium": 900,
                    },
                    {
                        "policy": "F",
                        "effective_date": "2018-04-01",
                        "expiration_date": "2018-09-30",
                        "written_premium": 1650,
                    },
                    {
                        "policy": "G",
                        "effective_date": "2018-08-01",
                        "expiration_date": "2019-07-31",
                        "written_premium": 1350,
                    },
                ],
            }
        ],
        "expected_answer": {
            "type": "multi_part_numeric",
            "parts": {
                "a": {"value": 3300.0, "tolerance": 0.01},
                "b": {"value": 2250.0, "tolerance": 0.01},
                "c": {"value": 3400.0, "tolerance": 0.01},
            },
        },
        "question_point_value": {
            "a": 0.25,
            "b": 0.25,
            "c": 0.5,
        },
        "source": "CAS Exam 5, Fall 2019, Question 2",
        "tags": [
            "written premium",
            "fiscal year accounting",
            "in-force premium",
            "calendar year",
            "policy cancellation",
        ],
    },
    {
        "question_id": "EX5-F19-Q03a",
        "domain": "ratemaking",
        "topic": "credibility_theory",
        "question_text": {
            "prompt": "Calculate the credibility-weighted indicated rate change using the classical credibility approach and trended present rates as the complement of credibility. The loss experience is considered fully credible if there is a 90% probability that the observed experience is within 2.5% of its expected value.",
            "type": "single_part",
        },
        "inputs": [
            {"name": "number_of_exposures", "type": "single_value", "data": 20000},
            {
                "name": "indicated_rate_change_before_credibility",
                "type": "single_value",
                "data": 0.079,
            },
            {"name": "projected_frequency", "type": "single_value", "data": 0.03},
            {"name": "annual_loss_trend", "type": "single_value", "data": -0.01},
            {"name": "annual_premium_trend", "type": "single_value", "data": 0.015},
            {
                "name": "target_effective_date",
                "type": "single_date",
                "data": "2019-01-01",
            },
            {
                "name": "prior_indicated_rate_change",
                "type": "single_value",
                "data": 0.08,
            },
            {
                "name": "prior_implemented_rate_change",
                "type": "single_value",
                "data": 0.035,
            },
            {
                "name": "prior_effective_date",
                "type": "single_date",
                "data": "2017-01-01",
            },
            {"name": "credibility_probability",
                "type": "single_value", "data": 0.90},
            {"name": "credibility_range", "type": "single_value", "data": 0.025},
            {
                "name": "normal_distribution_table",
                "type": "table",
                "data": [
                    {"p": 0.800, "z": 0.842},
                    {"p": 0.850, "z": 1.036},
                    {"p": 0.900, "z": 1.282},
                    {"p": 0.950, "z": 1.645},
                    {"p": 0.975, "z": 1.960},
                    {"p": 0.990, "z": 2.326},
                ],
            },
        ],
        "expected_answer": {
            "type": "point_estimate",
            "value": 0.0248,
            "tolerance": 0.0001,
        },
        "question_point_value": 2.25,
        "source": "CAS Exam 5, Fall 2019, Question 3a",
        "tags": [
            "credibility",
            "indicated rate change",
            "classical credibility",
            "trended present rates",
            "premium trend",
            "loss trend",
        ],
    },
    {
        "question_id": "EX5-F19-Q05ab",
        "domain": "ratemaking",
        "topic": "loss_trending",
        "question_text": {
            "prompt": "The following is to be used in developing a rate indication effective January 1, 2021:\n- Indication is based on accident year experience\n- Historical experience is from accident year 2018\n- Annual loss trend is +2%",
            "type": "multi_part",
            "parts": {
                "a": "Calculate the appropriate loss trend factor to trend from 7/1/2018 to 1/1/2022.",
                "b": "Calculate the appropriate loss trend factor to trend from 1/1/2019 to 1/1/2022.",
            },
        },
        "expected_answer": {
            "type": "multi_part_numeric",
            "parts": {
                "a": {"value": 1.072, "tolerance": 0.001},
                "b": {"value": 1.061, "tolerance": 0.001},
            },
        },
        "question_point_value": {
            "a": 0.5,
            "b": 0.5,
        },
        "source": "CAS Exam 5, Fall 2019, Question 5 a & b",
        "tags": ["loss trend", "trend factor calculation", "ratemaking"],
    },
    {
        "question_id": "EX5-F19-Q07",
        "domain": "ratemaking",
        "topic": "premium_calculations",
        "question_text": {
            "prompt": (
                "Given the following data as of December 31, 2018, calculate the indicated rate change for policies effective January 1, 2020 "
                "using the reported Bornhuetter‐Ferguson technique for the last three accident years, "
                "given the data provided."
            ),
            "type": "single_part",
        },
        "inputs": [
            {
                "name": "reported_loss_alae",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2016,
                        "reported_12": 3440000,
                        "reported_24": 4107000,
                        "reported_36": 4522000,
                    },
                    {
                        "accident_year": 2017,
                        "reported_12": 3427000,
                        "reported_24": 4109000,
                        "reported_36": None,
                    },
                    {
                        "accident_year": 2018,
                        "reported_12": 3545000,
                        "reported_24": None,
                        "reported_36": None,
                    },
                ],
            },
            {
                "name": "calendar_year_premium_fixed_expenses",
                "type": "table",
                "data": [
                    {
                        "calendar_year": 2016,
                        "earned_premium": 10500000,
                        "fixed_expenses": 1155000,
                    },
                    {
                        "calendar_year": 2017,
                        "earned_premium": 12000000,
                        "fixed_expenses": 3600000,
                    },
                    {
                        "calendar_year": 2018,
                        "earned_premium": 12500000,
                        "fixed_expenses": 1500000,
                    },
                ],
            },
            {
                "name": "rate_change_history",
                "type": "table",
                "data": [
                    {"effective_date": "2017-07-01", "change": 0.05},
                    {"effective_date": "2018-07-01", "change": 0.02},
                ],
            },
            {"name": "annual_loss_trend", "type": "single_value", "data": 0.04},
            {"name": "annual_premium_trend", "type": "single_value", "data": 0.03},
            {"name": "expected_loss_alae_ratio",
                "type": "single_value", "data": 0.60},
            {"name": "variable_expense_ratio", "type": "single_value", "data": 0.30},
            {
                "name": "profit_contingencies_provision",
                "type": "single_value",
                "data": 0.05,
            },
            {"name": "ulae_provision", "type": "single_value", "data": 0.07},
            {
                "name": "tail_factor_36_to_ultimate",
                "type": "single_value",
                "data": 1.031,
            },
            {
                "name": "notes",
                "type": "notes",
                "data": (
                    "In 2017 the company implemented a new policy issuance system. "
                    "Rates are in effect for one year; all policies are annual and written evenly throughout each calendar year."
                ),
            },
        ],
        "expected_answer": {
            "type": "point_estimate",
            "value": -0.12,
            "tolerance": 0.001,
        },
        "question_point_value": 4.5,
        "source": "CAS Exam 5, Fall 2019, Question 7",
        "tags": [
            "ratemaking",
            "Bornhuetter-Ferguson",
            "rate_indication",
            "loss_ratio",
            "trended_present_rates",
        ],
    },
    {
        "question_id": "EX5-F19-Q13",
        "domain": "ratemaking",
        "topic": "specialty_calculations",
        "question_text": {
            "prompt": "Given the following information, calculate the indicated increased limit factor for the $200,000 limit.",
            "type": "single_part",
        },
        "inputs": [
            {
                "name": "policy_data",
                "type": "table",
                "data": [
                    {"policy_limit": 50000, "claims": 145, "pct_at_limit": 1.0},
                    {"policy_limit": 100000, "claims": 550, "pct_at_limit": 0.6},
                    {"policy_limit": 200000, "claims": 875, "pct_at_limit": 0.4},
                ],
            },
            {
                "name": "notes",
                "type": "notes",
                "data": (
                    "All claim payments are either 50% of the policy limit or 100% of the policy limit.\n"
                    "$50,000 is the basic limit."
                ),
            },
        ],
        "expected_answer": {
            "type": "point_estimate",
            "value": 2.646,
            "tolerance": 0.001,
        },
        "question_point_value": 1.75,
        "source": "CAS Exam 5, Fall 2019, Question 13",
        "tags": ["ILF", "limited average severity", "ratemaking"],
    },
    {
        "question_id": "EX5-F19-Q18a",
        "domain": "reserving",
        "topic": "development_techniques",
        "question_text": {
            "prompt": "Estimate unpaid claims for accident year 2018 as of December 31, 2018 using a case outstanding development technique.",
            "type": "single_part",
        },
        "inputs": [
            {
                "name": "cumulative_paid_claims",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "paid_12": 1200000,
                        "paid_24": 2325000,
                        "paid_36": 2900000,
                        "paid_48": 3100000,
                    },
                    {
                        "accident_year": 2016,
                        "paid_12": 1800000,
                        "paid_24": 3300000,
                        "paid_36": 4100000,
                        "paid_48": None,
                    },
                    {
                        "accident_year": 2017,
                        "paid_12": 1500000,
                        "paid_24": 2800000,
                        "paid_36": None,
                        "paid_48": None,
                    },
                    {
                        "accident_year": 2018,
                        "paid_12": 1700000,
                        "paid_24": None,
                        "paid_36": None,
                        "paid_48": None,
                    },
                ],
            },
            {
                "name": "case_outstanding",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "os_12": 1500000,
                        "os_24": 800000,
                        "os_36": 400000,
                        "os_48": 160000,
                    },
                    {
                        "accident_year": 2016,
                        "os_12": 2000000,
                        "os_24": 1150000,
                        "os_36": 575000,
                        "os_48": None,
                    },
                    {
                        "accident_year": 2017,
                        "os_12": 1750000,
                        "os_24": 975000,
                        "os_36": None,
                        "os_48": None,
                    },
                    {
                        "accident_year": 2018,
                        "os_12": 2200000,
                        "os_24": None,
                        "os_36": None,
                        "os_48": None,
                    },
                ],
            },
            {
                "name": "development_factor_48_to_ult",
                "type": "single_value",
                "data": 1.15,
            },
            {
                "name": "notes",
                "type": "notes",
                "data": "There is no paid or reported development beyond 60 months.",
            },
        ],
        "expected_answer": {"type": "point_estimate", "value": 3092.76, "tolerance": 1},
        "question_point_value": 1.75,
        "source": "CAS Exam 5, Fall 2019, Question 18a",
        "tags": ["reserving", "development", "case outstanding"],
    },
    {
        "question_id": "EX5-F19-Q19",
        "domain": "reserving",
        "topic": "reserving_methods",
        "question_text": {
            "prompt": "Given the following data as of December 31, 2018, calculate ultimate claims for accident year 2017 using the Cape Cod technique.",
            "type": "single_part",
        },
        "inputs": [
            {
                "name": "reported_claims_and_premium",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2016,
                        "reported_claims": 7200000,
                        "earned_premium": 10400000,
                    },
                    {
                        "accident_year": 2017,
                        "reported_claims": 6300000,
                        "earned_premium": 11000000,
                    },
                    {
                        "accident_year": 2018,
                        "reported_claims": 4700000,
                        "earned_premium": 11500000,
                    },
                ],
            },
            {
                "name": "age_to_ultimate_factors",
                "type": "table",
                "data": [
                    {"age_to_ult": "12-ult", "factor": 1.764},
                    {"age_to_ult": "24-ult", "factor": 1.260},
                    {"age_to_ult": "36-ult", "factor": 1.050},
                    {"age_to_ult": "48-ult", "factor": 1.000},
                ],
            },
            {
                "name": "annual_trends",
                "type": "table",
                "data": [
                    {"type": "claims", "trend": 0.03},
                    {"type": "premium", "trend": 0.02},
                ],
            },
            {
                "name": "rate_changes",
                "type": "table",
                "data": [
                    {"effective_date": "2016-07-01", "rate_change": 0.04},
                    {"effective_date": "2017-07-01", "rate_change": 0.02},
                ],
            },
            {
                "name": "notes",
                "type": "notes",
                "data": "All policies have an annual term and are written evenly throughout the year.",
            },
        ],
        "expected_answer": {
            "type": "point_estimate",
            "value": 7932000,
            "tolerance": 600,
        },
        "question_point_value": 3,
        "source": "CAS Exam 5, Fall 2019, Question 19",
        "tags": ["cape cod", "reserving", "development"],
    },
    {
        "question_id": "EX5-F19-Q20a",
        "domain": "reserving",
        "topic": "frequency_severity",
        "question_text": {
            "prompt": "Use the frequency-severity disposal rate technique to estimate unpaid claims for accident year 2018.",
            "type": "single_part",
        },
        "inputs": [
            {
                "name": "closed_claim_counts",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "closed_12": 308,
                        "closed_24": 555,
                        "closed_36": 642,
                        "closed_48": 647,
                        "ultimate_count": 647,
                    },
                    {
                        "accident_year": 2016,
                        "closed_12": 356,
                        "closed_24": 563,
                        "closed_36": 678,
                        "closed_48": None,
                        "ultimate_count": 683,
                    },
                    {
                        "accident_year": 2017,
                        "closed_12": 358,
                        "closed_24": 575,
                        "closed_36": None,
                        "closed_48": None,
                        "ultimate_count": 684,
                    },
                    {
                        "accident_year": 2018,
                        "closed_12": 402,
                        "closed_24": None,
                        "closed_36": None,
                        "closed_48": None,
                        "ultimate_count": 795,
                    },
                ],
            },
            {
                "name": "cumulative_paid_claims",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "paid_12": 375000,
                        "paid_24": 745000,
                        "paid_36": 906000,
                        "paid_48": 916000,
                    },
                    {
                        "accident_year": 2016,
                        "paid_12": 397000,
                        "paid_24": 750000,
                        "paid_36": 922000,
                        "paid_48": None,
                    },
                    {
                        "accident_year": 2017,
                        "paid_12": 422000,
                        "paid_24": 762000,
                        "paid_36": None,
                        "paid_48": None,
                    },
                    {
                        "accident_year": 2018,
                        "paid_12": 385000,
                        "paid_24": None,
                        "paid_36": None,
                        "paid_48": None,
                    },
                ],
            },
            {
                "name": "notes",
                "type": "notes",
                "data": (
                    "A court decision on December 31, 2018 will increase future claim payments by 20%.\n"
                    "All claims are closed by age 48.\n"
                    "There is no severity trend."
                ),
            },
        ],
        "expected_answer": {"type": "point_estimate", "value": 764848, "tolerance": 1},
        "source": "CAS Exam 5, Fall 2019, Question 20a",
        "tags": ["frequency-severity disposal rate", "reserving", "disposal rate"],
    },
    {
        "question_id": "EX5-F19-Q21",
        "domain": "reserving",
        "topic": "reserving_methods",
        "question_text": {
            "prompt": "Calculate unpaid claims for accident year 2018 using the reported Berquist-Sherman technique.",
            "type": "single_part",
        },
        "inputs": [
            {
                "name": "reported_claims",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "reported_12": 1100000,
                        "reported_24": 1650000,
                        "reported_36": 1675000,
                        "reported_48": 1680000,
                    },
                    {
                        "accident_year": 2016,
                        "reported_12": 1250000,
                        "reported_24": 1680000,
                        "reported_36": 1750000,
                        "reported_48": None,
                    },
                    {
                        "accident_year": 2017,
                        "reported_12": 1200000,
                        "reported_24": 1800000,
                        "reported_36": None,
                        "reported_48": None,
                    },
                    {
                        "accident_year": 2018,
                        "reported_12": 1500000,
                        "reported_24": None,
                        "reported_36": None,
                        "reported_48": None,
                    },
                ],
            },
            {
                "name": "reported_claim_counts",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "count_12": 108,
                        "count_24": 115,
                        "count_36": 115,
                        "count_48": 115,
                    },
                    {
                        "accident_year": 2016,
                        "count_12": 112,
                        "count_24": 120,
                        "count_36": 120,
                        "count_48": None,
                    },
                    {
                        "accident_year": 2017,
                        "count_12": 104,
                        "count_24": 110,
                        "count_36": None,
                        "count_48": None,
                    },
                    {
                        "accident_year": 2018,
                        "count_12": 106,
                        "count_24": None,
                        "count_36": None,
                        "count_48": None,
                    },
                ],
            },
            {
                "name": "paid_claims",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "paid_12": 560000,
                        "paid_24": 1325000,
                        "paid_36": 1650000,
                        "paid_48": 1680000,
                    },
                    {
                        "accident_year": 2016,
                        "paid_12": 650000,
                        "paid_24": 1350000,
                        "paid_36": 1720000,
                        "paid_48": None,
                    },
                    {
                        "accident_year": 2017,
                        "paid_12": 615000,
                        "paid_24": 1305000,
                        "paid_36": None,
                        "paid_48": None,
                    },
                    {
                        "accident_year": 2018,
                        "paid_12": 625000,
                        "paid_24": None,
                        "paid_36": None,
                        "paid_48": None,
                    },
                ],
            },
            {
                "name": "closed_claim_counts",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "closed_12": 78,
                        "closed_24": 106,
                        "closed_36": 114,
                        "closed_48": 115,
                    },
                    {
                        "accident_year": 2016,
                        "closed_12": 80,
                        "closed_24": 111,
                        "closed_36": 118,
                        "closed_48": None,
                    },
                    {
                        "accident_year": 2017,
                        "closed_12": 75,
                        "closed_24": 99,
                        "closed_36": None,
                        "closed_48": None,
                    },
                    {
                        "accident_year": 2018,
                        "closed_12": 82,
                        "closed_24": None,
                        "closed_36": None,
                        "closed_48": None,
                    },
                ],
            },
            {"name": "severity_trend", "type": "single_value", "data": 0.05},
            {
                "name": "notes",
                "type": "notes",
                "data": "Exposures have remained constant throughout all accident years.",
            },
        ],
        "expected_answer": {
            "type": "point_estimate",
            "value": 1006000,
            "tolerance": 3000,
        },
        "question_point_value": 2.25,
        "source": "CAS Exam 5, Fall 2019, Question 21",
        "tags": ["berquist-sherman", "reported development", "reserving"],
    },
    {
        "question_id": "EX5-F19-Q24a",
        "domain": "reserving",
        "topic": "specialty_calculations",
        "question_text": {
            "prompt": "Calculate unpaid ULAE at December 31, 2018 using the Kittel refinement.",
            "type": "single_part",
        },
        "inputs": [
            {
                "name": "calendar_year_data",
                "type": "table",
                "data": [
                    {
                        "calendar_year": 2015,
                        "paid_claims": 18700,
                        "incurred_claims": 35500,
                        "paid_ulae": 1870,
                    },
                    {
                        "calendar_year": 2016,
                        "paid_claims": 19200,
                        "incurred_claims": 36500,
                        "paid_ulae": 1890,
                    },
                    {
                        "calendar_year": 2017,
                        "paid_claims": 18900,
                        "incurred_claims": 36400,
                        "paid_ulae": 1910,
                    },
                    {
                        "calendar_year": 2018,
                        "paid_claims": 19800,
                        "incurred_claims": 37400,
                        "paid_ulae": 1990,
                    },
                ],
            },
            {
                "name": "report_year_data",
                "type": "table",
                "data": [
                    {
                        "report_year": 2015,
                        "earned_premium": 77600,
                        "paid_claims": 22400,
                        "reported_claims": 29500,
                        "pct_unreported": 0.107,
                    },
                    {
                        "report_year": 2016,
                        "earned_premium": 78000,
                        "paid_claims": 14300,
                        "reported_claims": 26200,
                        "pct_unreported": 0.231,
                    },
                    {
                        "report_year": 2017,
                        "earned_premium": 77800,
                        "paid_claims": 5500,
                        "reported_claims": 20700,
                        "pct_unreported": 0.559,
                    },
                    {
                        "report_year": 2018,
                        "earned_premium": 77900,
                        "paid_claims": 2800,
                        "reported_claims": 19000,
                        "pct_unreported": 0.763,
                    },
                ],
            },
            {"name": "expected_claims_ratio", "type": "single_value", "data": 0.45},
            {"name": "notes", "type": "notes",
                "data": "All policies are claims-made."},
        ],
        "expected_answer": {"type": "point_estimate", "value": 3800, "tolerance": 60},
        "question_point_value": 1.5,
        "source": "CAS Exam 5, Fall 2019, Question 24a",
        "tags": ["ulae", "kittel refinement", "reserving"],
    },
    {
        "question_id": "EX5-F19-Q25a",
        "domain": "reserving",
        "topic": "development_techniques",
        "question_text": {
            "prompt": "Calculate the accident year 2018 expected net paid claims for the period 15 to 18 months based on the method specified.",
            "type": "multi_part",
            "parts": {
                "i": "Assuming claims emerge uniformly between evaluation points.",
                "ii": "Using the industry payment pattern.",
            },
        },
        "inputs": [
            {
                "name": "development_factors",
                "type": "table",
                "data": [
                    {
                        "description": "12-ultimate gross paid claims development factor",
                        "value": 5.00,
                    },
                    {
                        "description": "24-ultimate gross paid claims development factor",
                        "value": 3.30,
                    },
                ],
            },
            {"name": "paid_gross_12m", "type": "single_value", "data": 12000000},
            {
                "name": "industry_payment_pattern_12_24",
                "type": "table",
                "data": [
                    {"interval": "12-15 months", "percent_paid": 0.50},
                    {"interval": "15-18 months", "percent_paid": 0.35},
                    {"interval": "18-21 months", "percent_paid": 0.10},
                    {"interval": "21-24 months", "percent_paid": 0.05},
                ],
            },
            {"name": "actual_net_paid_15_18",
                "type": "single_value", "data": 1450000},
            {"name": "quota_share_ceded", "type": "single_value", "data": 0.30},
            {
                "name": "notes",
                "type": "notes",
                "data": "Ultimate losses are estimated using the paid development technique.",
            },
        ],
        "expected_answer": {
            "type": "multi_part_numeric",
            "parts": {
                "i": {"value": 1081818, "tolerance": 1},
                "ii": {"value": 1514545, "tolerance": 1},
            },
        },
        "question_point_value": 1.25,
        "source": "CAS Exam 5, Fall 2019, Question 25a",
        "tags": ["paid development", "reserving", "quota share"],
    },
    {
        "question_id": "EX5-S19-Q01",
        "domain": "ratemaking",
        "topic": "premium_calculations",
        "question_text": {
            "prompt": "Given the following information, answer the question:",
            "type": "multi_part",
            "parts": {
                "a": "Calculate the calendar year 2018 written exposures.",
                "b": "Calculate the calendar year 2018 earned exposures.",
                "c": "Calculate the policy year 2018 earned exposures as of February 28, 2019.",
                "d": "Calculate the in-force exposures as of October 15, 2018.",
            },
        },
        "inputs": [
            {
                "name": "policies",
                "type": "table",
                "data": [
                    {
                        "policy": "A",
                        "vehicles": 2,
                        "effective_date": "2018-01-01",
                        "expiration_date": "2018-06-30",
                    },
                    {
                        "policy": "B",
                        "vehicles": 3,
                        "effective_date": "2018-03-01",
                        "expiration_date": "2018-08-31",
                    },
                    {
                        "policy": "C",
                        "vehicles": 1,
                        "effective_date": "2018-07-01",
                        "expiration_date": "2018-12-31",
                    },
                    {
                        "policy": "D",
                        "vehicles": 2,
                        "effective_date": "2018-10-01",
                        "expiration_date": "2019-03-31",
                    },
                    {
                        "policy": "E",
                        "vehicles": 1,
                        "effective_date": "2018-11-01",
                        "expiration_date": "2019-04-30",
                    },
                ],
            },
            {
                "name": "notes",
                "type": "notes",
                "data": [
                    "All policies remain in-force until their expiration dates.",
                    "An exposure is defined as one vehicle insured for one year.",
                ],
            },
        ],
        "expected_answer": {
            "type": "multi_part_numeric",
            "parts": {
                "a": {"value": 4.50, "tolerance": 0.01},
                "b": {"value": 3.67, "tolerance": 0.01},
                "c": {"value": 4.17, "tolerance": 0.01},
                "d": {"value": 1.50, "tolerance": 0.01},
            },
        },
        "question_point_value": {
            "a": 0.25,
            "b": 0.5,
            "c": 0.5,
            "d": 0.25,
        },
        "source": "CAS Exam 5, Spring 2019, Question 1",
        "tags": [
            "written exposure",
            "earned exposure",
            "in-force exposure",
            "calendar year vs policy year",
            "exposure base evaluation",
        ],
    },
    {
        "question_id": "EX5-S19-Q02a",
        "domain": "ratemaking",
        "topic": "premium_calculations",
        "question_text": {
            "prompt": "Given the following, calculate the trended on-level earned premium for 2017 to be used in a rate change effective July 1, 2019.",
            "type": "single_part",
        },
        "inputs": [
            {
                "name": "calendar_year_earned_premium",
                "type": "table",
                "data": [
                    {"calendar_year": 2017, "earned_premium": 3850000},
                    {"calendar_year": 2018, "earned_premium": 4200000},
                ],
            },
            {
                "name": "rate_changes",
                "type": "table",
                "data": [
                    {"effective_date": "2017-01-01", "overall_rate_change": 0.10},
                    {"effective_date": "2017-07-01", "overall_rate_change": 0.05},
                ],
            },
            {
                "name": "average_written_premium",
                "type": "table",
                "data": [
                    {
                        "quarter": "2Q 2016",
                        "average_written_premium_at_current_rate_level": 1771,
                    },
                    {
                        "quarter": "4Q 2016",
                        "average_written_premium_at_current_rate_level": 1806,
                    },
                    {
                        "quarter": "2Q 2017",
                        "average_written_premium_at_current_rate_level": 1840,
                    },
                    {
                        "quarter": "4Q 2017",
                        "average_written_premium_at_current_rate_level": 1877,
                    },
                    {
                        "quarter": "2Q 2018",
                        "average_written_premium_at_current_rate_level": 1914,
                    },
                    {
                        "quarter": "4Q 2018",
                        "average_written_premium_at_current_rate_level": 1953,
                    },
                ],
            },
            {
                "name": "notes",
                "type": "notes",
                "data": [
                    "No rate changes occurred in 2016 or 2018.",
                    "Rates will be in effect for one year.",
                    "All policies are semi-annual.",
                    "All policies are written uniformly throughout the year.",
                ],
            },
        ],
        "expected_answer": {"type": "point_estimate", "value": 4554236.00, "tolerance": 10000},
        "question_point_value": 1.75,
        "source": "CAS Exam 5, Spring 2019, Question 2 part a",
        "tags": [
            "trended premium",
            "on-level premium",
            "earned premium",
            "rate trend",
            "parallelogram method",
        ],
    },
    {
        "question_id": "EX5-S19-Q04ab",
        "domain": "ratemaking",
        "topic": "loss_trending",
        "question_text": {
            "prompt": "Given the following information:",
            "type": "multi_part",
            "parts": {
                "a": "Calculate the basic limits loss trend over a one-year timeframe.",
                "b": "Calculate the excess loss trend over a one-year timeframe.",
            },
        },
        "inputs": [
            {
                "name": "claim_total_limits_losses",
                "type": "table",
                "data": [
                    {"claim_number": 1, "total_limits_loss": 15000},
                    {"claim_number": 2, "total_limits_loss": 21000},
                    {"claim_number": 3, "total_limits_loss": 24000},
                    {"claim_number": 4, "total_limits_loss": 55000},
                ],
            },
            {"name": "annual_severity_trend", "type": "single_value", "data": 0.08},
            {"name": "basic_limit", "type": "single_value", "data": 25000},
        ],
        "expected_answer": {
            "type": "multi_part_numeric",
            "parts": {
                "a": {"value": 0.04565, "tolerance": 0.0005},
                "b": {"value": 0.17733, "tolerance": 0.0005},
            },
        },
        "question_point_value": {
            "a": 1,
            "b": 0.75,
        },
        "source": "CAS Exam 5, Spring 2019, Question 4 parts a & b",
        "tags": [
            "basic limits loss trend",
            "excess loss trend",
            "severity trend",
            "ratemaking",
        ],
    },
    {
        "question_id": "EX5-S19-Q05a",
        "domain": "ratemaking",
        "topic": "development_techniques",
        "question_text": {
            "prompt": "Given the following loss data as of December 31, 2018 for an insurer, calculate the projected trended ultimate losses for accident year 2018 to be used to determine a rate change effective January 1, 2020. ",
            "type": "single_part",
        },
        "inputs": [
            {
                "name": "cumulative_reported_losses",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2012,
                        "12": None,
                        "24": None,
                        "36": None,
                        "48": 169000000,
                    },
                    {
                        "accident_year": 2013,
                        "12": None,
                        "24": None,
                        "36": None,
                        "48": 181000000,
                    },
                    {
                        "accident_year": 2014,
                        "12": None,
                        "24": None,
                        "36": None,
                        "48": 180000000,
                    },
                    {
                        "accident_year": 2015,
                        "12": None,
                        "24": None,
                        "36": None,
                        "48": 169000000,
                    },
                    {
                        "accident_year": 2016,
                        "12": None,
                        "24": None,
                        "36": 161000000,
                        "48": None,
                    },
                    {
                        "accident_year": 2017,
                        "12": None,
                        "24": 150000000,
                        "36": None,
                        "48": None,
                    },
                    {
                        "accident_year": 2018,
                        "12": 121000000,
                        "24": None,
                        "36": None,
                        "48": None,
                    },
                ],
            },
            {
                "name": "shock_losses",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2012,
                        "claim_count": 3,
                        "reported_ground_up_losses": 3000000,
                    },
                    {
                        "accident_year": 2013,
                        "claim_count": 4,
                        "reported_ground_up_losses": 5000000,
                    },
                    {
                        "accident_year": 2014,
                        "claim_count": 3,
                        "reported_ground_up_losses": 3000000,
                    },
                    {
                        "accident_year": 2015,
                        "claim_count": 1,
                        "reported_ground_up_losses": 600000,
                    },
                    {
                        "accident_year": 2016,
                        "claim_count": 1,
                        "reported_ground_up_losses": 900000,
                    },
                    {
                        "accident_year": 2017,
                        "claim_count": 0,
                        "reported_ground_up_losses": 0,
                    },
                    {
                        "accident_year": 2018,
                        "claim_count": 1,
                        "reported_ground_up_losses": 900000,
                    },
                ],
            },
            {
                "name": "age_to_age_development_factors",
                "type": "table",
                "data": [
                    {"age_to_age": "12-24", "factor": 1.20},
                    {"age_to_age": "24-36", "factor": 1.10},
                    {"age_to_age": "36-48", "factor": 1.05},
                ],
            },
            {
                "name": "excess_loss_threshold",
                "type": "single_value",
                "data": 500000,
            },
            {
                "name": "exponential_trend_fits",
                "type": "table",
                "data": [
                    {
                        "experience_period_points": "20 point",
                        "frequency_trend": 0.017,
                        "total_severity_trend": 0.050,
                    },
                    {
                        "experience_period_points": "16 point",
                        "frequency_trend": 0.014,
                        "total_severity_trend": 0.054,
                    },
                    {
                        "experience_period_points": "12 point",
                        "frequency_trend": 0.018,
                        "total_severity_trend": 0.051,
                    },
                    {
                        "experience_period_points": "8 point",
                        "frequency_trend": 0.015,
                        "total_severity_trend": 0.020,
                    },
                    {
                        "experience_period_points": "6 point",
                        "frequency_trend": 0.013,
                        "total_severity_trend": 0.001,
                    },
                    {
                        "experience_period_points": "4 point",
                        "frequency_trend": 0.016,
                        "total_severity_trend": 0.000,
                    },
                ],
            },
            {
                "name": "notes",
                "type": "notes",
                "data": [
                    "All policies are annual.",
                    "Rates will be in effect for one year.",
                    "There is no development after 48 months.",
                    "Loss development is the same for basic and excess losses.",
                    "Accident years 2012 through 2015 are used to estimate the shock loss adjustment.",
                ],
            },
        ],
        "expected_answer": {
            "type": "point_estimate",
            "value": 175238000.00,
            "tolerance": 500000,
        },
        "question_point_value": 3.75,
        "source": "CAS Exam 5, Spring 2019, Question 5 part a",
        "tags": ["ultimate losses", "loss trending", "loss development", "ratemaking"],
    },
    {
        "question_id": "EX5-S19-Q06abd",
        "domain": "ratemaking",
        "topic": "expense_analysis",
        "question_text": {
            "prompt": "Given the following countrywide information:",
            "type": "multi_part",
            "parts": {
                "a": "Select and justify a total expense ratio for use in ratemaking assuming all expenses are variable.",
                "b": "Calculate the variable permissible loss ratio using the expense ratio from part a.",
                "d": "Calculate the variable permissible loss ratio if 100% of the taxes, licenses & fees and 75% of the general expenses do not vary by premium.",
            },
        },
        "inputs": [
            {
                "name": "historic_expense_ratios",
                "type": "table",
                "data": [
                    {
                        "expense_category": "Commission & Brokerage",
                        "2016_expense_ratio": 0.120,
                        "2017_expense_ratio": 0.130,
                    },
                    {
                        "expense_category": "Other Acquisition",
                        "2016_expense_ratio": 0.128,
                        "2017_expense_ratio": 0.127,
                    },
                    {
                        "expense_category": "General Expenses",
                        "2016_expense_ratio": 0.150,
                        "2017_expense_ratio": 0.055,
                    },
                    {
                        "expense_category": "Taxes, Licenses & Fees",
                        "2016_expense_ratio": 0.021,
                        "2017_expense_ratio": 0.022,
                    },
                ],
            },
            {
                "name": "expense_incurred_2018",
                "type": "table",
                "data": [
                    {
                        "expense_category": "Commission & Brokerage",
                        "amount": 945000,
                    },
                    {"expense_category": "Other Acquisition", "amount": 760000},
                    {"expense_category": "General Expenses", "amount": 325000},
                    {
                        "expense_category": "Taxes, Licenses & Fees",
                        "amount": 130000,
                    },
                ],
            },
            {
                "name": "direct_premium_written_2018",
                "type": "single_value",
                "data": 6100000,
            },
            {
                "name": "direct_premium_earned_2018",
                "type": "single_value",
                "data": 5920000,
            },
            {"name": "profit_provision", "type": "single_value", "data": 0.07},
        ],
        "expected_answer": {
            "type": "multi_part_numeric",
            "parts": {
                "a": {"value": 0.356, "tolerance": 0.005},
                "b": {"value": 0.574, "tolerance": 0.001},
                "d": {"value": 0.636, "tolerance": 0.001},
            },
        },
        "question_point_value": {
            "a": 1.25,
            "b": 0.25,
            "d": 0.5,
        },
        "source": "CAS Exam 5, Spring 2019, Question 6 parts a, b & d",
        "tags": [
            "expense ratio selection",
            "variable permissible loss ratio",
            "ratemaking expenses",
        ],
    },
    {
        "question_id": "EX5-SP19-Q07ab",
        "domain": "ratemaking",
        "topic": "credibility_theory",
        "question_text": {
            "prompt": "Given the following data as of December 31, 2018:",
            "type": "multi_part",
            "parts": {
                "ai": "Calculate the ultimate loss and ALAE for accident year 2016 using the reported Bornhuetter-Ferguson technique.",
                "aii": "Calculate the ultimate loss and ALAE for accident year 2017 using the reported Bornhuetter-Ferguson technique.",
                "aiii": "Calculate the ultimate loss and ALAE for accident year 2018 using the reported Bornhuetter-Ferguson technique.",
                "b": "Calculate the credibility-weighted indicated rate change using the latest three accident years.",
            },
        },
        "inputs": [
            {
                "name": "reported_losses_and_ALAE",
                "type": "table",
                "data": [
                    {"accident_year": 2016, "reported_loss_and_ALAE": 2000000},
                    {"accident_year": 2017, "reported_loss_and_ALAE": 1750000},
                    {"accident_year": 2018, "reported_loss_and_ALAE": 800000},
                ],
            },
            {
                "name": "earned_premium",
                "type": "table",
                "data": [
                    {"calendar_year": 2016, "earned_premium": 4600000},
                    {"calendar_year": 2017, "earned_premium": 5100000},
                    {"calendar_year": 2018, "earned_premium": 5800000},
                ],
            },
            {
                "name": "selected_cumulative_development_to_ultimate",
                "type": "table",
                "data": [
                    {"development_age": 12, "selected_cdf_to_ult": 4.90},
                    {"development_age": 24, "selected_cdf_to_ult": 2.08},
                    {"development_age": 36, "selected_cdf_to_ult": 1.46},
                ],
            },
            {
                "name": "expected_loss_and_ALAE_ratio",
                "type": "single_value",
                "data": 0.65,
            },
            {
                "name": "annual_loss_and_alae_trend",
                "type": "single_value",
                "data": 0.04,
            },
            {"name": "annual_premium_trend", "type": "single_value", "data": 0.03},
            {"name": "fixed_expense_ratio", "type": "single_value", "data": 0.06},
            {"name": "variable_expense_ratio", "type": "single_value", "data": 0.26},
            {
                "name": "profit_and_contingencies_provision",
                "type": "single_value",
                "data": 0.05,
            },
            {
                "name": "ulae_provision_as_percent_of_loss_and_alae",
                "type": "single_value",
                "data": 0.08,
            },
            {
                "name": "credibility_of_historical_experience",
                "type": "single_value",
                "data": 0.70,
            },
            {
                "name": "complement_of_credibility_rate_change",
                "type": "single_value",
                "data": 0.08,
            },
        ],
        "expected_answer": {
            "type": "multi_part_numeric",
            "parts": {
                "ai": {"value": 2942000, "tolerance": 1000},
                "aii": {"value": 3471000, "tolerance": 1000},
                "aiii": {"value": 3801000, "tolerance": 1000},
                "b": {"value": 0.1126, "tolerance": 0.0001},
            },
        },
        "question_point_value": {
            "ai": 0.15,
            "aii": 0.15,
            "aiii": 0.15,
            "b": 3.5,
        },
        "source": "CAS Exam 5, Spring 2019, Question 7ab",
        "tags": [
            "Bornhuetter-Ferguson",
            "ultimate loss",
            "credibility",
            "indicated rate change",
        ],
    },
    {
        "question_id": "EX5-SP19-Q13c",
        "domain": "ratemaking",
        "topic": "premium_calculations",
        "question_text": {
            "prompt": "Given the following private passenger auto BI data as of December 31, 2018 for two states as of December 31, 2018:",
            "type": "multi_part",
            "parts": {
                "ai": "Calculate the indicated pure premium for BI coverage in State A.",
                "bi": "Calculate the indicated pure premium for BI coverage in State B.",
            },
        },
        "inputs": [
            {
                "name": "state_A_exposure_and_claims",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2016,
                        "earned_exposure": 36000,
                        "ultimate_claim_count": 50,
                    },
                    {
                        "accident_year": 2017,
                        "earned_exposure": 37800,
                        "ultimate_claim_count": 60,
                    },
                    {
                        "accident_year": 2018,
                        "earned_exposure": 41580,
                        "ultimate_claim_count": 72,
                    },
                ],
            },
            {
                "name": "state_A_ultimate_severity",
                "type": "single_value",
                "data": 15000,
            },
            {
                "name": "state_B_exposure_and_claims",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2016,
                        "earned_exposure": 100000,
                        "ultimate_claim_count": 1250,
                    },
                    {
                        "accident_year": 2017,
                        "earned_exposure": 105000,
                        "ultimate_claim_count": 1300,
                    },
                    {
                        "accident_year": 2018,
                        "earned_exposure": 110250,
                        "ultimate_claim_count": 1375,
                    },
                ],
            },
            {
                "name": "state_B_ultimate_severity",
                "type": "single_value",
                "data": 10000,
            },
        ],
        "expected_answer": {
            "type": "multi_part_numeric",
            "parts": {
                "ai": {"value": 25.97, "tolerance": 0.01},
                "bi": {"value": 124.72, "tolerance": 0.01},
            },
        },
        "question_point_value": {
            "ai": 0.375,
            "bi": 0.375,
        },
        "source": "CAS Exam 5 Spring 2019 Question 13c",
        "tags": ["pure premium", "frequency", "severity", "ratemaking"],
    },
    {
        "question_id": "EX5-SP19-Q15a",
        "domain": "ratemaking",
        "topic": "reserving_methods",
        "question_text": {
            "prompt": "Given the following data evaluated as of December 31, 2018, calculate an unpaid claims estimate for accident year 2018 using a frequency-severity technique.",
            "type": "single_part",
        },
        "inputs": [
            {
                "name": "cumulative_reported_claim_counts",
                "type": "table",
                "data": [
                    {"accident_year": 2015, "12": 250,
                        "24": 238, "36": 245, "48": 260},
                    {
                        "accident_year": 2016,
                        "12": 275,
                        "24": 270,
                        "36": 278,
                        "48": None,
                    },
                    {
                        "accident_year": 2017,
                        "12": 323,
                        "24": 320,
                        "36": None,
                        "48": None,
                    },
                    {
                        "accident_year": 2018,
                        "12": 375,
                        "24": None,
                        "36": None,
                        "48": None,
                    },
                ],
            },
            {
                "name": "cumulative_reported_claims",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "12": 1250000,
                        "24": 1280000,
                        "36": 1325000,
                        "48": 1430000,
                    },
                    {
                        "accident_year": 2016,
                        "12": 1365000,
                        "24": 1395000,
                        "36": 1450000,
                        "48": None,
                    },
                    {
                        "accident_year": 2017,
                        "12": 1625000,
                        "24": 1675000,
                        "36": None,
                        "48": None,
                    },
                    {
                        "accident_year": 2018,
                        "12": 1900000,
                        "24": None,
                        "36": None,
                        "48": None,
                    },
                ],
            },
            {
                "name": "reported_count_age_to_age_factors",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "12_to_24": 0.952,
                        "24_to_36": 1.029,
                        "36_to_48": 1.061,
                    },
                    {
                        "accident_year": 2016,
                        "12_to_24": 0.982,
                        "24_to_36": 1.030,
                        "36_to_48": None,
                    },
                    {
                        "accident_year": 2017,
                        "12_to_24": 0.991,
                        "24_to_36": None,
                        "36_to_48": None,
                    },
                ],
            },
            {
                "name": "paid_claims_to_date_2018",
                "type": "single_value",
                "data": 700000,
            },
            {
                "name": "no_development_after_48_months",
                "type": "notes",
                "data": "There is no development after 48 months.",
            },
        ],
        "expected_answer": {"type": "point_estimate", "value": 1482000, "tolerance": 1000},
        "question_point_value": 2,
        "source": "CAS Exam 5, Spring 2019, Question 15a",
        "tags": [
            "IBNR",
            "frequency-severity",
            "frequency development",
            "severity development",
        ],
    },
    {
        "question_id": "EX5-SP19-Q16a",
        "domain": "ratemaking",
        "topic": "development_techniques",
        "question_text": {
            "prompt": "Given the following data for an insurance company evaluated as of December 31, 2018, caalculate the company's accident year 2018 ultimate claims using the reported claim development technique.",
            "type": "single_part",
        },
        "inputs": [
            {
                "name": "cumulative_reported_claims",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "12": 900000,
                        "24": 2150000,
                        "36": 3125000,
                        "48": 3900000,
                    },
                    {
                        "accident_year": 2016,
                        "12": 800000,
                        "24": 2075000,
                        "36": 3225000,
                        "48": None,
                    },
                    {
                        "accident_year": 2017,
                        "12": 850000,
                        "24": 2125000,
                        "36": None,
                        "48": None,
                    },
                    {
                        "accident_year": 2018,
                        "12": 950000,
                        "24": None,
                        "36": None,
                        "48": None,
                    },
                ],
            },
            {
                "name": "development_factor_48_to_ultimate",
                "type": "single_value",
                "data": 1.10,
            },
        ],
        "expected_answer": {"type": "point_estimate", "value": 4892000, "tolerance": 1000},
        "question_point_value": 0.75,
        "source": "CAS Exam 5, Spring 2019, Question 16 part a",
        "tags": ["chain ladder", "reported development", "ultimate claims"],
    },
    {
        "question_id": "EX5-SP19-Q17ab",
        "domain": "ratemaking",
        "topic": "reserving_methods",
        "question_text": {
            "prompt": "Given the following information for a company that writes the same line of business in Region 1 and Region 2, as of December 31, 2018:",
            "type": "multi_part",
            "parts": {
                "a": "Estimate the ultimate claims for Region 1 for accident year 2017 using the reported Bornhuetter–Ferguson technique.",
                "b": "Estimate the total ultimate claims (Region 1 + Region 2) for accident year 2018 using the reported Bornhuetter–Ferguson technique.",
            },
        },
        "inputs": [
            {
                "name": "reported_claims",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2016,
                        "region1": 180000000,
                        "region2": 200000000,
                        "combined": 380000000,
                    },
                    {
                        "accident_year": 2017,
                        "region1": 150000000,
                        "region2": 180000000,
                        "combined": 330000000,
                    },
                    {
                        "accident_year": 2018,
                        "region1": None,
                        "region2": None,
                        "combined": 180000000,
                    },
                ],
            },
            {
                "name": "age_to_ultimate_factors",
                "type": "table",
                "data": [
                    {"age": "12-to-ult", "region1": 2.283, "region2": 1.558},
                    {"age": "24-to-ult", "region1": 1.154, "region2": 1.192},
                ],
            },
            {
                "name": "earned_premium",
                "type": "table",
                "data": [
                    {
                        "calendar_year": 2016,
                        "region1": 900000000,
                        "region2": 900000000,
                        "combined": 1800000000,
                    },
                    {
                        "calendar_year": 2017,
                        "region1": 1000000000,
                        "region2": 1000000000,
                        "combined": 2000000000,
                    },
                    {
                        "calendar_year": 2018,
                        "region1": 1610000000,
                        "region2": 690000000,
                        "combined": 2300000000,
                    },
                ],
            },
            {
                "name": "annual_industry_trends",
                "type": "table",
                "data": [
                    {
                        "region_1_frequency": -0.02,
                        "region_1_severity": 0.10,
                        "region_2_frequency": 0,
                        "region_2_severity": 0,
                        "combined_frequency": -0.01,
                        "combined_severity": 0.05,
                    }
                ],
            },
            {
                "name": "expected_claims_ratio",
                "type": "table",
                "data": [
                    {
                        "region": "Region 2",
                        "accident_year": 2016,
                        "expected_ratio": 0.40,
                    },
                    {
                        "region": "Combined",
                        "accident_year": 2016,
                        "expected_ratio": 0.458,
                    },
                ],
            },
            {
                "name": "notes",
                "type": "notes",
                "data": [
                    "Equal amount of business is underwritten in both regions for the entire industry.",
                    "The company is subject to the same claims trends as the industry.",
                    "Each region is fully credible.",
                    "There have been no rate changes in 2017 or 2018.",
                    "There is no premium trend.",
                ],
            },
        ],
        "expected_answer": {
            "type": "multi_part_numeric",
            "parts": {
                "a": {"value": 224224, "tolerance": 50},
                "b": {"value": 821722, "tolerance": 400},
            },
        },
        "question_point_value": {
            "a": 1,
            "b": 1.25,
        },
        "source": "CAS Exam 5, Spring 2019, Question 17 parts a & b",
        "tags": ["Bornhuetter–Ferguson", "chain ladder", "loss trending", "ratemaking"],
    },
    {
        "question_id": "EX5-SP19-Q18a",
        "domain": "ratemaking",
        "topic": "reserving_methods",
        "question_text": {
            "prompt": "Given the following information as of December 31, 2018, calculate the ultimate claims for accident year 2017 using the reported Cape Cod technique.",
            "type": "single_part",
        },
        "inputs": [
            {
                "name": "reported_claims",
                "type": "table",
                "columns": [
                    "accident_year",
                    "reported_claims",
                    "age_to_ultimate_factor",
                ],
                "data": [
                    {
                        "accident_year": 2016,
                        "reported_claims": 2900,
                        "age_to_ultimate_factor": 2.300,
                    },
                    {
                        "accident_year": 2017,
                        "reported_claims": 1800,
                        "age_to_ultimate_factor": 3.900,
                    },
                    {
                        "accident_year": 2018,
                        "reported_claims": 1000,
                        "age_to_ultimate_factor": 7.600,
                    },
                ],
            },
            {
                "name": "earned_premium_($000s)",
                "type": "table",
                "columns": [
                    "accident_year",
                    "earned_premium",
                    "pure_premium_trend_factor",
                ],
                "data": [
                    {
                        "accident_year": 2016,
                        "earned_premium": 6500,
                        "pure_premium_trend_factor": 1.067,
                    },
                    {
                        "accident_year": 2017,
                        "earned_premium": 8100,
                        "pure_premium_trend_factor": 0.983,
                    },
                    {
                        "accident_year": 2018,
                        "earned_premium": 8000,
                        "pure_premium_trend_factor": 1.000,
                    },
                ],
            },
            {
                "name": "notes",
                "type": "notes",
                "data": [
                    "There are no historical rate changes.",
                    "There is no premium trend.",
                ],
            },
        ],
        "expected_answer": {"type": "point_estimate", "value": 7835, "tolerance": 0},
        "question_point_value": 1.5,
        "source": "CAS Exam 5, Spring 2019, Question 18 part a",
        "tags": ["Cape Cod", "ultimate claims", "loss development", "ratemaking"],
    },
    {
        "question_id": "EX5-SP19-Q19i_ii",
        "domain": "ratemaking",
        "topic": "reserving_methods",
        "question_text": {
            "prompt": "Given the following as of December 31, 2018 (with tort reform reducing future claim payments by 20% effective January 1, 2019):",
            "type": "multi_part",
            "parts": {
                "i": "Determine the ultimate claims using the reported development technique.",
                "ii": "Determine the ultimate claims using the reported Bornhuetter–Ferguson technique.",
            },
        },
        "inputs": [
            {"name": "earned_premium", "type": "single_value", "data": 2500000},
            {"name": "expected_claims_ratio", "type": "single_value", "data": 0.60},
            {
                "name": "reported_claims_at_12_months",
                "type": "single_value",
                "data": 1285000,
            },
            {
                "name": "age_to_ultimate_factor_at_12_months",
                "type": "single_value",
                "data": 1.385,
            },
            {
                "name": "paid_claims_at_12_months",
                "type": "single_value",
                "data": 625000,
            },
            {
                "name": "tort_reform_future_reduction",
                "type": "single_value",
                "data": 0.20,
            },
            {
                "name": "notes",
                "type": "notes",
                "data": [
                    "There are no historical rate changes.",
                    "There is no premium trend.",
                    "Tort reform reduces all future claim payments by 20%.",
                ],
            },
        ],
        "expected_answer": {
            "type": "multi_part_numeric",
            "parts": {
                "i": {"value": 1549000, "tolerance": 1000},
                "ii": {"value": 1487000, "tolerance": 1000},
            },
        },
        "question_point_value": {
            "i": 0.625,
            "ii": 0.625,
        },
        "source": "CAS Exam 5, Spring 2019, Question 19 parts i & ii",
        "tags": [
            "reported development",
            "Bornhuetter-Ferguson",
            "tort reform",
            "frequency-severity",
        ],
    },
    {
        "question_id": "EX5-SP19-Q20a",
        "domain": "ratemaking",
        "topic": "specialty_calculations",
        "question_text": {
            "prompt": "Given the following information as of December 31, 2018, estimate the trended tail severity for age 84 and older at 2018 cost levels.",
            "type": "single_part",
        },
        "inputs": [
            {
                "name": "incremental_closed_claim_counts",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2011,
                        "72_months": 141,
                        "84_months": 81,
                        "96_months": 13,
                    },
                    {
                        "accident_year": 2012,
                        "72_months": 145,
                        "84_months": 61,
                        "96_months": None,
                    },
                    {
                        "accident_year": 2013,
                        "72_months": 59,
                        "84_months": None,
                        "96_months": None,
                    },
                ],
            },
            {
                "name": "incremental_paid_claims",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2011,
                        "72_months": 7600000,
                        "84_months": 6100000,
                        "96_months": 2400000,
                    },
                    {
                        "accident_year": 2012,
                        "72_months": 8800000,
                        "84_months": 3900000,
                        "96_months": None,
                    },
                    {
                        "accident_year": 2013,
                        "72_months": 5600000,
                        "84_months": None,
                        "96_months": None,
                    },
                ],
            },
            {"name": "annual_severity_trend", "type": "single_value", "data": 0.06},
            {
                "name": "legislative_reduction_after_Jan1_2012",
                "type": "single_value",
                "data": 0.20,
            },
        ],
        "expected_answer": {
            "type": "point_estimate",
            "value": 101658,
            "tolerance": 100,
        },
        "question_point_value": 1.5,
        "source": "CAS Exam 5, Spring 2019, Question 20 part a",
        "tags": ["tail severity", "incremental claims", "severity trend", "ratemaking"],
    },
    {
        "question_id": "EX5-SP19-Q22",
        "domain": "ratemaking",
        "topic": "reserving_methods",
        "question_text": {
            "prompt": "Given the following, calculate the estimated ultimate claims for accident year 2018 using the reported development technique adjusting for the change in case reserve adequacy.",
            "type": "single_part",
        },
        "inputs": [
            {
                "name": "average_case_outstanding_large",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "12_months": 650,
                        "24_months": 700,
                        "36_months": 720,
                        "48_months": 850,
                    },
                    {
                        "accident_year": 2016,
                        "12_months": 670,
                        "24_months": 700,
                        "36_months": 900,
                        "48_months": None,
                    },
                    {
                        "accident_year": 2017,
                        "12_months": 750,
                        "24_months": 1000,
                        "36_months": None,
                        "48_months": None,
                    },
                    {
                        "accident_year": 2018,
                        "12_months": 1200,
                        "24_months": None,
                        "36_months": None,
                        "48_months": None,
                    },
                ],
            },
            {
                "name": "average_case_outstanding_small",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "12_months": 75,
                        "24_months": 310,
                        "36_months": 75,
                        "48_months": 50,
                    },
                    {
                        "accident_year": 2016,
                        "12_months": 80,
                        "24_months": 400,
                        "36_months": 65,
                        "48_months": None,
                    },
                    {
                        "accident_year": 2017,
                        "12_months": 110,
                        "24_months": 190,
                        "36_months": None,
                        "48_months": None,
                    },
                    {
                        "accident_year": 2018,
                        "12_months": 90,
                        "24_months": None,
                        "36_months": None,
                        "48_months": None,
                    },
                ],
            },
            {
                "name": "open_large_claim_counts",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "12_months": 14,
                        "24_months": 16,
                        "36_months": 18,
                        "48_months": 22,
                    },
                    {
                        "accident_year": 2016,
                        "12_months": 15,
                        "24_months": 18,
                        "36_months": 20,
                        "48_months": None,
                    },
                    {
                        "accident_year": 2017,
                        "12_months": 11,
                        "24_months": 13,
                        "36_months": None,
                        "48_months": None,
                    },
                    {
                        "accident_year": 2018,
                        "12_months": 10,
                        "24_months": None,
                        "36_months": None,
                        "48_months": None,
                    },
                ],
            },
            {
                "name": "open_small_claim_counts",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "12_months": 150,
                        "24_months": 115,
                        "36_months": 100,
                        "48_months": 80,
                    },
                    {
                        "accident_year": 2016,
                        "12_months": 155,
                        "24_months": 130,
                        "36_months": 120,
                        "48_months": None,
                    },
                    {
                        "accident_year": 2017,
                        "12_months": 145,
                        "24_months": 120,
                        "36_months": None,
                        "48_months": None,
                    },
                    {
                        "accident_year": 2018,
                        "12_months": 150,
                        "24_months": None,
                        "36_months": None,
                        "48_months": None,
                    },
                ],
            },
            {
                "name": "cumulative_paid_large",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "12_months": 520000,
                        "24_months": 802000,
                        "36_months": 1021000,
                        "48_months": 1140000,
                    },
                    {
                        "accident_year": 2016,
                        "12_months": 510000,
                        "24_months": 789000,
                        "36_months": 1008000,
                        "48_months": None,
                    },
                    {
                        "accident_year": 2017,
                        "12_months": 540000,
                        "24_months": 829000,
                        "36_months": None,
                        "48_months": None,
                    },
                    {
                        "accident_year": 2018,
                        "12_months": 525000,
                        "24_months": None,
                        "36_months": None,
                        "48_months": None,
                    },
                ],
            },
            {
                "name": "cumulative_paid_small",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "12_months": 25000,
                        "24_months": 55000,
                        "36_months": 174000,
                        "48_months": 268000,
                    },
                    {
                        "accident_year": 2016,
                        "12_months": 23000,
                        "24_months": 37000,
                        "36_months": 170000,
                        "48_months": None,
                    },
                    {
                        "accident_year": 2017,
                        "12_months": 20000,
                        "24_months": 67000,
                        "36_months": None,
                        "48_months": None,
                    },
                    {
                        "accident_year": 2018,
                        "12_months": 22000,
                        "24_months": None,
                        "36_months": None,
                        "48_months": None,
                    },
                ],
            },
            {"name": "severity_trend", "type": "single_value", "data": 0.05},
            {
                "name": "development_factors_large",
                "type": "table",
                "data": [
                    {"age_to_ult": "12-to-ult", "factor": 2.638},
                    {"age_to_ult": "24-to-ult", "factor": 1.715},
                    {"age_to_ult": "36-to-ult", "factor": 1.345},
                    {"age_to_ult": "48-to-ult", "factor": 1.200},
                ],
            },
            {
                "name": "development_factors_small",
                "type": "table",
                "data": [
                    {"age_to_ult": "12-to-ult", "factor": 9.007},
                    {"age_to_ult": "24-to-ult", "factor": 3.597},
                    {"age_to_ult": "36-to-ult", "factor": 1.798},
                    {"age_to_ult": "48-to-ult", "factor": 1.200},
                ],
            },
            {
                "name": "notes",
                "type": "notes",
                "data": [
                    "Large claims defined as ≥ $500,000; small claims < $500,000.",
                    "In 2018, new personnel increased reserve adequacy on large claims only.",
                    "Case reserves on small claims unaffected.",
                    "No changes to settlement rates.",
                ],
            },
        ],
        "expected_answer": {
            "type": "point_estimate",
            "value": 1718596,
            "tolerance": 100,
        },
        "question_point_value": 2.5,
        "source": "CAS Exam 5, Spring 2019, Question 22",
        "tags": [
            "reported development",
            "case reserve adequacy",
            "tail severity",
            "ratemaking",
        ],
    },
    {
        "question_id": "EX5-SP19-Q23",
        "domain": "ratemaking",
        "topic": "reserving_methods",
        "question_text": {
            "prompt": "Given the following as of December 31, 2018, calculate the estimated retained IBNR for all accident years using the reported development technique.",
            "type": "single_part",
        },
        "inputs": [
            {
                "name": "per_occurrence_retention_and_stop_loss",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "per_occurrence_retention": 1000000,
                        "stop_loss_limit": 10000000,
                    },
                    {
                        "accident_year": 2016,
                        "per_occurrence_retention": 1000000,
                        "stop_loss_limit": 10000000,
                    },
                    {
                        "accident_year": 2017,
                        "per_occurrence_retention": 1500000,
                        "stop_loss_limit": 5000000,
                    },
                    {
                        "accident_year": 2018,
                        "per_occurrence_retention": 2000000,
                        "stop_loss_limit": 7000000,
                    },
                ],
            },
            {
                "name": "reported_claims_under_retention",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "reported_claims": 2000000,
                        "percent_reported": 0.70,
                    },
                    {
                        "accident_year": 2016,
                        "reported_claims": 1500000,
                        "percent_reported": 0.35,
                    },
                    {
                        "accident_year": 2017,
                        "reported_claims": 800000,
                        "percent_reported": 0.20,
                    },
                    {
                        "accident_year": 2018,
                        "reported_claims": 450000,
                        "percent_reported": 0.10,
                    },
                ],
            },
            {
                "name": "large_claims_not_included",
                "type": "table",
                "data": [
                    {
                        "claim_id": "A",
                        "accident_year": 2015,
                        "reported_claim": 1200000,
                    },
                    {
                        "claim_id": "B",
                        "accident_year": 2015,
                        "reported_claim": 1500000,
                    },
                    {
                        "claim_id": "C",
                        "accident_year": 2016,
                        "reported_claim": 3000000,
                    },
                    {
                        "claim_id": "D",
                        "accident_year": 2017,
                        "reported_claim": 1750000,
                    },
                ],
            },
            {
                "name": "notes",
                "type": "notes",
                "data": [
                    "2015 and 2016 have a combined stop-loss limit of $10,000,000 that applies to claims occurring in both years.",
                    "Large claims (above per-occurrence retention) will not develop further.",
                    "All other claims develop to ultimate via 1 / percent_reported.",
                ],
            },
        ],
        "expected_answer": {
            "type": "point_estimate",
            "value": 10250000,
            "tolerance": 10000,
        },
        "question_point_value": 1.5,
        "source": "CAS Exam 5, Spring 2019, Question 23",
        "tags": ["IBNR", "retention", "reported development", "excess of loss"],
    },
    {
        "question_id": "EX5-SP19-Q24a",
        "domain": "ratemaking",
        "topic": "reserving_methods",
        "question_text": {
            "prompt": "Given the following information as of December 31, 2018, estimate ultimate ALAE for accident year 2018 using the multiplicative ratio development approach.",
            "type": "single_part",
        },
        "inputs": [
            {
                "name": "cumulative_paid_claims_only",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "12": 3800000,
                        "24": 10640000,
                        "36": 15960000,
                        "48": 17556000,
                    },
                    {
                        "accident_year": 2016,
                        "12": 3900000,
                        "24": 10920000,
                        "36": 15600000,
                        "48": None,
                    },
                    {
                        "accident_year": 2017,
                        "12": 3850000,
                        "24": 11858000,
                        "36": None,
                        "48": None,
                    },
                    {
                        "accident_year": 2018,
                        "12": 4050000,
                        "24": None,
                        "36": None,
                        "48": None,
                    },
                ],
            },
            {
                "name": "cumulative_paid_ALAE",
                "type": "table",
                "data": [
                    {
                        "accident_year": 2015,
                        "12": 77000,
                        "24": 316000,
                        "36": 512000,
                        "48": 571000,
                    },
                    {
                        "accident_year": 2016,
                        "12": 81000,
                        "24": 337000,
                        "36": 517000,
                        "48": None,
                    },
                    {
                        "accident_year": 2017,
                        "12": 75000,
                        "24": 334000,
                        "36": None,
                        "48": None,
                    },
                    {
                        "accident_year": 2018,
                        "12": 82000,
                        "24": None,
                        "36": None,
                        "48": None,
                    },
                ],
            },
            {
                "name": "selected_ultimate_claims_only",
                "type": "table",
                "data": [
                    {"accident_year": 2015, "ultimate_claims_only": 17500000},
                    {"accident_year": 2016, "ultimate_claims_only": 17900000},
                    {"accident_year": 2017, "ultimate_claims_only": 17600000},
                    {"accident_year": 2018, "ultimate_claims_only": 18500000},
                ],
            },
            {
                "name": "notes",
                "type": "notes",
                "data": ["No development beyond 48 months."],
            },
        ],
        "expected_answer": {
            "type": "point_estimate",
            "value": 595700,
            "tolerance": 100,
        },
        "question_point_value": 1.25,
        "source": "CAS Exam 5, Spring 2019, Question 24 part a",
        "tags": ["ALAE", "multiplicative ratio", "reported development", "ratemaking"],
    },
]

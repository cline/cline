---
name: dummy-dataset
description: "Generate realistic dummy datasets for testing with customizable columns, constraints, and output formats (CSV, JSON, SQL, Python script). Use when creating test data, building mock datasets, or generating sample data for development and demos."
---
# Dummy Dataset Generation

Generate realistic dummy datasets for testing with customizable columns, constraints, and output formats (CSV, JSON, SQL, Python script). Creates executable scripts or direct data files for immediate use.

**Use when:** Creating test data, generating sample datasets, building realistic mock data for development, or populating test environments.

**Arguments:**
- `$PRODUCT`: The product or system name
- `$DATASET_TYPE`: Type of data (e.g., customer feedback, transactions, user profiles)
- `$ROWS`: Number of rows to generate (default: 100)
- `$COLUMNS`: Specific columns or fields to include
- `$FORMAT`: Output format (CSV, JSON, SQL, Python script)
- `$CONSTRAINTS`: Additional constraints or business rules

## Step-by-Step Process

1. **Identify dataset type** - Understand the data domain
2. **Define column specifications** - Names, data types, and value ranges
3. **Determine row count** - How many sample records needed
4. **Select output format** - CSV, JSON, SQL INSERT, or Python script
5. **Apply realistic patterns** - Ensure data looks authentic and valid
6. **Add business constraints** - Respect business logic and relationships
7. **Generate or script data** - Create executable output
8. **Validate output** - Ensure data quality and completeness

## Template: Python Script Output

```python
import csv
import json
from datetime import datetime, timedelta
import random

# Configuration
ROWS = $ROWS
FILENAME = "$DATASET_TYPE.csv"

# Column definitions with realistic value generators
columns = {
    "id": "auto-increment",
    "name": "first_last_name",
    "email": "email",
    "created_at": "timestamp",
    # Add more columns...
}

def generate_dataset():
    """Generate realistic dummy dataset"""
    data = []
    for i in range(1, ROWS + 1):
        record = {
            "id": f"U{i:06d}",
            # Generate values based on column definitions
        }
        data.append(record)
    return data

def save_as_csv(data, filename):
    """Save dataset as CSV"""
    with open(filename, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=data[0].keys())
        writer.writeheader()
        writer.writerows(data)

if __name__ == "__main__":
    dataset = generate_dataset()
    save_as_csv(dataset, FILENAME)
    print(f"Generated {len(dataset)} records in {FILENAME}")
```

## Example Dataset Specification

**Dataset Type:** Customer Feedback

**Columns:**
- feedback_id (auto-increment, U001, U002...)
- customer_name (realistic names)
- email (valid email format)
- feedback_date (dates last 90 days)
- rating (1-5 stars)
- category (Bug, Feature Request, Complaint, Praise)
- text (realistic feedback)
- product (electronics, clothing, home)

**Constraints:**
- Ratings skewed: 40% 5-star, 30% 4-star, 20% 3-star, 10% 1-2 star
- Bug category only with ratings 1-3
- Feature requests only with ratings 3-5
- Email domains realistic (gmail, yahoo, company.com)

## Output Deliverables

- Ready-to-execute Python script OR direct data file
- CSV file with proper headers and formatting
- JSON file with valid structure and types
- SQL INSERT statements for database population
- Data validation and constraint compliance
- Realistic, business-appropriate values
- Documentation of data generation logic
- Quick-start instructions for using the dataset

## Output Formats

**CSV:** Flat tabular format, easy to import into spreadsheets and databases

**JSON:** Nested structure, ideal for APIs and NoSQL databases

**SQL:** INSERT statements, directly executable on relational databases

**Python Script:** Executable generator for custom or large datasets

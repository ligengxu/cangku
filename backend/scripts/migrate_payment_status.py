#!/usr/bin/env python3
"""One-time migration: mark all historical unpaid orders as paid."""

import pymysql

DB_CONFIG = {
    "host": "36.134.229.82",
    "port": 3306,
    "user": "root",
    "password": "Amz24639.",
    "database": "my_sk9",
    "charset": "utf8mb4",
}


def main():
    conn = pymysql.connect(**DB_CONFIG)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE fruit_purchases SET payment_status = 'paid' "
                "WHERE payment_status = 'unpaid' AND deleted_at IS NULL"
            )
            fruit_count = cur.rowcount

            cur.execute(
                "UPDATE carton_box_purchases SET payment_status = 'paid' "
                "WHERE payment_status = 'unpaid' AND deleted_at IS NULL"
            )
            carton_count = cur.rowcount

            cur.execute(
                "UPDATE simple_material_purchases SET payment_status = 'paid' "
                "WHERE payment_status = 'unpaid' AND deleted_at IS NULL"
            )
            material_count = cur.rowcount

        conn.commit()
        print(f"fruit_purchases: {fruit_count} rows updated")
        print(f"carton_box_purchases: {carton_count} rows updated")
        print(f"simple_material_purchases: {material_count} rows updated")
    finally:
        conn.close()


if __name__ == "__main__":
    main()

import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1790704980989 implements MigrationInterface {
  name = 'CreateVideos1790704980989';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('draft', 'processing', 'ready', 'error')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel_id" uuid NOT NULL, "public_id" uuid NOT NULL, "title" character varying(200) NOT NULL, "status" "public"."videos_status_enum" NOT NULL DEFAULT 'draft', "storage_key" character varying(500) NOT NULL, "thumbnail_key" character varying(500), "upload_id" character varying(500), "expected_size" bigint NOT NULL, "size_bytes" bigint, "content_type" character varying(100) NOT NULL, "duration_ms" integer, "width" integer, "height" integer, "video_codec" character varying(100), "container_format" character varying(100), "processing_error" character varying(200), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_39a1f0fe7991162aace659078ec" UNIQUE ("public_id"), CONSTRAINT "UQ_6ce3c9805943abd5b2950847b64" UNIQUE ("storage_key"), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_33b997d60e0bac645832489a2a" ON "videos" ("channel_id", "status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_33b997d60e0bac645832489a2a"`,
    );
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}

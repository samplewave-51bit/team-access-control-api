declare module 's3rver' {
  interface S3rverBucketConfig {
    name: string;
    [key: string]: unknown;
  }

  interface S3rverOptions {
    port?: number;
    address?: string;
    silent?: boolean;
    directory?: string;
    configureBuckets?: S3rverBucketConfig[];
    [key: string]: unknown;
  }

  class S3rver {
    constructor(options: S3rverOptions);
    run(): Promise<S3rver>;
    close(): Promise<void>;
  }

  export = S3rver;
}

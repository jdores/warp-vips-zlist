 This worker will update the gateway list with WARP virtual IPs. It works in combination with the warp-vips workers and okta-group-users worker.
  
 The worker can be triggered on demand when querying the worker hostname AND according to a cron schedule
  
 The gateway lists that will be updated are set in wrangler.toml (env.GROUPS)
 The same groups some have been set in the okta-group-users worker. Also the worker right now requires the gateway lists to be pre-created in the dashboard (they can be empty)
  
 Optional: if we want the output to be saved to R2 set env.STORE_R2 in wrangler.toml to true

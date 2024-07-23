/**
 * This worker will update the gateway list with WARP virtual IPs. It works in combination with the warp-vips worker and okta-group-users worker.
 * 
 * The worker can be triggered on demand when querying the worker hostname AND according to a cron schedule
 * 
 * The gateway lists that will be updated are set in wrangler.toml (env.GROUPS)
 * The same groups some have been set in the okta-group-users worker. Also the worker right now requires the gateway lists to be pre-created in the dashboard (they can be empty)
 * 
 * Optional: if we want the output to be saved to R2 set env.STORE_R2 in wrangler.toml to true
 *
 */

export default {
	// This function runs when we query the worker hostname
	async fetch(request, env, ctx) {
		return await handleRequest(request, env);
	},

  // This function runs according to the cron schedule
    async scheduled(event, env, ctx) {
      await handleRequest('notfetch',env);
  }
};

async function handleRequest(request, env) {

  // Inputs for Cloudflare API calls. Stored locally in .dev.var and in the edge in Workers secrets
  const accountId = env.ACCOUNT_ID;
  const userEmail = env.USER_EMAIL;
  const apiKey = env.API_KEY;
  const inputDevicesR2File = env.R2_INPUT_DEVICES_FILENAME;
  const inputGroupsR2File = env.R2_INPUT_GROUPS_FILENAME;
  const groups = env.GROUPS;
  const outputR2Files = env.R2_OUTPUT_FILENAMES;
  const r2Bucket = env.MY_BUCKET;

  // Optimization - if fetch, stop the worker if browser is requesting favicon.ico
  if (request != 'notfetch') {
	const urlRequest = new URL(request.url);
	const checkFavicon = urlRequest.pathname.slice(1);
	if(checkFavicon == "favicon.ico"){
		return new Response(null, { status: 204 });
	}
  }

  // STEP 01 - fetch the Devices JSON file from the R2 bucket
  const r2DevicesResponse = await r2Bucket.get(inputDevicesR2File);
  if (!r2DevicesResponse) {
	return new Response(JSON.stringify({ error: 'File not found in R2 bucket' }), {
	  status: 404,
	  headers: {
		'Content-Type': 'application/json',
	  },
	});
  }
  const r2DevicesData = await r2DevicesResponse.json();

  // STEP 02 - fetch the Groups JSON file from the R2 bucket
  const r2GroupsResponse = await r2Bucket.get(inputGroupsR2File);
  if (!r2GroupsResponse) {
	return new Response(JSON.stringify({ error: 'File not found in R2 bucket' }), {
	  status: 404,
	  headers: {
		'Content-Type': 'application/json',
	  },
	});
  }
  const r2GroupsData = await r2GroupsResponse.json();

  // STEP 03 - get the id of the lists that need to be updated
  let gwListUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/gateway/lists`;
  let gwListResponse = await fetch(gwListUrl, {
		method: 'GET',
		headers: {
			'X-Auth-Email': userEmail,
			'X-Auth-Key': apiKey,
			'Content-Type': 'application/json'
		}
	});
  let gwListData = await gwListResponse.json();

  for (let group of groups){
    // STEP 03.a - create the Zero Trust lists that needs to be pushed to the dashboard - add new entries
    const ztListResult = {"remove": [], "append": []}

    for (let device of r2DevicesData) {
      for (let user of r2GroupsData){
        if ((device.email == user.email) && (user.group) == group){
          ztListResult.append.push({ "description": "USER:"+user.email+"; DEVICE:"+device.name+"; TYPE:"+device.type, "value": device.vip})
        }
      }
    }
    // STEP 03.b - create the Zero Trust lists that needs to be pushed to the dashboard - remove old entries
    for (let list in gwListData.result){
      if (gwListData.result[list].name == outputR2Files+group){
        const gwListUpdate = `https://api.cloudflare.com/client/v4/accounts/${accountId}/gateway/lists/${gwListData.result[list].id}`

        let gwCleanResponse = await fetch(gwListUpdate+"/items", {
          method: 'GET',
          headers: {
            'X-Auth-Email': userEmail,
            'X-Auth-Key': apiKey,
            'Content-Type': 'application/json'
          }
        });
        let gwCleanData = await gwCleanResponse.json();
        
        console.log("The data I need to clean from the list: "+gwCleanData.result)
        if (gwCleanData.result != null){
          for (let entry of gwCleanData.result) {
            ztListResult.remove.push(entry.value)
          }
        }

      // This is the body of the payload that will update the list
      const jsonOutput = JSON.stringify(ztListResult);

      // STEP 04 - Store output in R2, if environmental variable STORE_R2 in wrangler.toml is set to true.
      if(env.STORE_R2 || request == 'notfetch'){
        const objectName = outputR2Files+group+".json";
        const uploadFile = new Blob([jsonOutput], { type: 'application/json' });
        await r2Bucket.put(objectName, uploadFile);
      }
      
      // STEP 05 - Update the ZT lists
      const response = await fetch(gwListUpdate, {
        method: 'PATCH',
        headers: {
          'X-Auth-Email': userEmail,
          'X-Auth-Key': apiKey,
          'Content-Type': 'application/json'
        },
        body: jsonOutput,
      });
      }
    }
  }

  // Fetch - Provide response
  if (request != 'notfetch') {
    return new Response(JSON.stringify("Gateway lists updated!"), {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}
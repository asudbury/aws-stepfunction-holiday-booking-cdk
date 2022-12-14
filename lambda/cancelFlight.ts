const { DynamoDB } = require('aws-sdk');
export {};

exports.handler = async function (event: any) {
  console.log('request:', JSON.stringify(event, undefined, 2));

  if (Math.random() < 0.4) {
    throw new Error('Internal Server Error');
  }

  let bookingID = '';
  if (typeof event.ReserveFlightResult !== 'undefined') {
    bookingID = event.ReserveFlightResult.Payload.booking_id;
  }

  // create AWS SDK clients

  const dynamo = new DynamoDB();

  const params = {
    TableName: process.env.TABLE_NAME,
    Key: {
      pk: { S: event.trip_id },
      sk: { S: 'FLIGHT#' + bookingID },
    },
  };

  // Call DynamoDB to add the item to the table

  const result = await dynamo
    .deleteItem(params)
    .promise()
    .catch((error: any) => {
      throw new Error(error);
    });

  console.log('deleted flight booking:');
  console.log(result);

  // return status of ok

  return { status: 'ok' };
};
